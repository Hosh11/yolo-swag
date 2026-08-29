"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Web Speech API bindings. The DOM lib's coverage of SpeechRecognition is
 * inconsistent across TS versions, so the surface we use is declared here
 * rather than assumed.
 */
interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResult {
  0: SpeechRecognitionAlternative;
  isFinal: boolean;
  length: number;
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResult };
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function dictationSupported(): boolean {
  return recognitionCtor() !== null;
}

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/* ------------------------------------------------------------------ */
/* speaking                                                            */
/* ------------------------------------------------------------------ */

/**
 * Wren is written as British. If the platform has an en-GB voice, use it —
 * a Midwestern American reading her lines undercuts the whole character.
 */
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  const british = voices.filter((v) => v.lang === "en-GB" || v.lang === "en_GB");
  const preferred = ["Serena", "Kate", "Stephanie", "Sonia", "Libby", "Martha", "Daniel"];

  for (const name of preferred) {
    const match = british.find((v) => v.name.includes(name));
    if (match) return match;
  }
  return british[0] ?? voices.find((v) => v.lang.startsWith("en")) ?? null;
}

/** Speech synthesis chokes on markdown punctuation; strip what it can't read. */
function clean(text: string): string {
  return text
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const SENTENCE = /[^.!?…]+[.!?…]+["'")\]]*\s*/g;

/**
 * Speaks Wren's reply as it streams, a sentence at a time.
 *
 * Waiting for the full response before speaking adds a long dead pause to
 * every exchange; speaking each token as it lands produces stutter. Sentence
 * boundaries are the natural unit — she starts talking about as fast as a
 * person would.
 */
export function useSpeaker(enabled: boolean) {
  const buffer = useRef("");
  const voice = useRef<SpeechSynthesisVoice | null>(null);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!speechSupported()) return;
    const load = () => {
      voice.current = pickVoice();
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  const utter = useCallback((text: string) => {
    const body = clean(text);
    if (!body) return;
    const utterance = new SpeechSynthesisUtterance(body);
    if (voice.current) utterance.voice = voice.current;
    utterance.lang = voice.current?.lang ?? "en-GB";
    utterance.rate = 1.05;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, []);

  const cancel = useCallback(() => {
    if (!speechSupported()) return;
    window.speechSynthesis.cancel();
    buffer.current = "";
    setSpeaking(false);
  }, []);

  /** Feed streamed text; complete sentences are spoken as they arrive. */
  const push = useCallback(
    (delta: string) => {
      if (!enabled || !speechSupported()) return;
      buffer.current += delta;

      const matches = buffer.current.match(SENTENCE);
      if (!matches) return;
      const spokenLength = matches.join("").length;
      buffer.current = buffer.current.slice(spokenLength);
      for (const sentence of matches) utter(sentence);
    },
    [enabled, utter],
  );

  /** Speak whatever is left over once the stream ends. */
  const flush = useCallback(() => {
    if (!enabled || !speechSupported()) return;
    const rest = buffer.current;
    buffer.current = "";
    if (rest.trim()) utter(rest);
  }, [enabled, utter]);

  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled, cancel]);

  return { push, flush, cancel, speaking };
}

/* ------------------------------------------------------------------ */
/* listening                                                           */
/* ------------------------------------------------------------------ */

/**
 * Push-to-talk dictation. Deliberately not continuous: an always-on mic that
 * silently drops what you said is worse than no mic, and continuous mode on
 * mobile Safari stops without firing onend.
 */
export function useDictation(handlers: {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
}) {
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);

  // Handlers are read through a ref so re-renders don't tear down the session.
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    setSupported(true);

    const instance = new Ctor();
    instance.lang = "en-GB";
    instance.continuous = false;
    instance.interimResults = true;

    instance.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) final += result[0].transcript;
        else interim += result[0].transcript;
      }
      if (interim) latest.current.onInterim(interim);
      if (final) latest.current.onFinal(final);
    };
    instance.onerror = () => setListening(false);
    instance.onend = () => setListening(false);

    recognition.current = instance;
    return () => {
      instance.onresult = null;
      instance.onerror = null;
      instance.onend = null;
      instance.abort();
    };
  }, []);

  const start = useCallback(() => {
    if (!recognition.current || listening) return;
    try {
      recognition.current.start();
      setListening(true);
    } catch {
      // start() throws if a session is already running; treat as already-on.
      setListening(true);
    }
  }, [listening]);

  const stop = useCallback(() => {
    recognition.current?.stop();
    setListening(false);
  }, []);

  return { listening, start, stop, supported };
}
