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
 * Voices the platform reports as female, by name. There is no gender field on
 * SpeechSynthesisVoice and no way to derive one, so a name list is the only
 * option available — these are the standard Apple, Microsoft and Google voices.
 */
const FEMALE = [
  "serena", "kate", "stephanie", "martha", "fiona", "moira", "tessa", "karen",
  "samantha", "catherine", "nicky", "ava", "allison", "susan", "zoe", "sonia",
  "libby", "hazel", "zira", "maisie", "olivia", "amelie", "female",
];

/**
 * Explicitly excluded. Daniel is the one that matters: it is the *default*
 * en-GB voice on Apple platforms, so anything that merely prefers British and
 * falls back to the first match lands on a man. An earlier version of this
 * file had Daniel in the preferred list outright, which is how Wren ended up
 * speaking in a male voice on iPadOS.
 */
const MALE = [
  "daniel", "arthur", "oliver", "george", "ryan", "thomas", "alex", "fred",
  "aaron", "rishi", "gordon", "male", "reed", "rocko", "eddy", "grandpa",
];

const has = (haystack: string, needles: string[]) =>
  needles.some((n) => haystack.includes(n));

/** Higher is better. Only voices scoring above zero are ever auto-selected. */
function score(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase();
  const lang = voice.lang.toLowerCase().replace("_", "-");

  if (!lang.startsWith("en")) return -1;
  // A man reading Wren's lines is worse than an American woman reading them.
  if (has(name, MALE)) return -1;

  let points = 1;
  if (has(name, FEMALE)) points += 8;
  if (lang.startsWith("en-gb")) points += 6;
  // Apple and Microsoft ship low-quality "compact" voices by default and
  // better ones on demand; the good ones announce themselves in the name.
  if (has(name, ["enhanced", "premium", "neural", "natural", "siri"])) points += 4;
  return points;
}

export function listVoices(): SpeechSynthesisVoice[] {
  if (!speechSupported()) return [];
  return window.speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith("en"))
    .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}

/**
 * Best available voice for Wren: British and female where the device has one,
 * never a voice known to be male, and preferring the higher-quality variants.
 */
function pickVoice(): SpeechSynthesisVoice | null {
  const ranked = listVoices();
  const best = ranked.find((v) => score(v) > 1);
  return best ?? ranked[0] ?? null;
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
const VOICE_KEY = "wren:voiceURI";

export function useSpeaker(enabled: boolean) {
  const buffer = useRef("");
  const voice = useRef<SpeechSynthesisVoice | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURIState] = useState<string | null>(null);

  useEffect(() => {
    if (!speechSupported()) return;

    // getVoices() is empty until the platform has loaded them, and on iOS that
    // happens after first paint — so this has to run again on voiceschanged.
    const load = () => {
      const available = listVoices();
      setVoices(available);

      let saved: string | null = null;
      try {
        saved = window.localStorage.getItem(VOICE_KEY);
      } catch {
        // Storage blocked; fall through to the automatic pick.
      }

      const chosen =
        (saved && available.find((v) => v.voiceURI === saved)) || pickVoice();
      voice.current = chosen;
      setVoiceURIState(chosen?.voiceURI ?? null);
    };

    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  /** Switch voice. Speaks a sample so the choice can be judged by ear. */
  const setVoiceURI = useCallback((uri: string) => {
    const chosen = listVoices().find((v) => v.voiceURI === uri);
    if (!chosen) return;
    voice.current = chosen;
    setVoiceURIState(uri);
    try {
      window.localStorage.setItem(VOICE_KEY, uri);
    } catch {
      // Choice just won't persist between sessions.
    }
    window.speechSynthesis.cancel();
    const sample = new SpeechSynthesisUtterance("Right then. This is me.");
    sample.voice = chosen;
    sample.lang = chosen.lang;
    sample.rate = 1.02;
    window.speechSynthesis.speak(sample);
  }, []);

  const utter = useCallback((text: string) => {
    const body = clean(text);
    if (!body) return;
    const utterance = new SpeechSynthesisUtterance(body);
    if (voice.current) utterance.voice = voice.current;
    utterance.lang = voice.current?.lang ?? "en-GB";
    // Slightly under the default. The stock voices race, and the flatness
    // reads as less robotic when the phrasing has a little more room.
    utterance.rate = 1.02;
    utterance.pitch = 1.05;
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

  /**
   * Speaks immediately, bypassing the sentence buffer — for anything that
   * has to happen synchronously inside a tap.
   *
   * iOS Safari only grants a page permission to use speechSynthesis if the
   * *first* speak() call in the session happens inside the call stack of a
   * genuine user gesture. push()/flush() run after a network round trip —
   * too late for that first call — so turning voice on speaks a short line
   * right there in the click handler. That both unlocks the API for every
   * later reply and gives the user immediate proof it actually works,
   * instead of a silent first reply and no way to tell why.
   */
  const speakNow = useCallback((text: string) => utter(text), [utter]);

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

  return { push, flush, cancel, speakNow, speaking, voices, voiceURI, setVoiceURI };
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
