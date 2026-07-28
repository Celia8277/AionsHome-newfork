import { useEffect, useRef } from "react";

type SfxKind = "hover" | "confirm" | "hotspot" | "error";

const SFX_VOLUME_KEY = "ki_co_sfx_volume_v1";
const LEGACY_SFX_VOLUME_KEY = "xiaowu_sfx_volume";
const DEFAULT_SFX_VOLUME = 0.72;
const VOLUME_CHANGE_EVENTS = ["ki-co-sfx-volume-changed", "xiaowu-sfx-volume-changed"];
const INTERACTIVE_SELECTOR = "button, a[href], summary, [role=\"button\"], [data-sfx]";
const HOVER_SELECTOR = "button:not(:disabled), a[href], summary, [role=\"button\"], [data-sfx]";

const SFX_SOURCES: Record<SfxKind, string> = {
  hover: "/cottage/audio/system/hover.wav",
  confirm: "/cottage/audio/system/confirm.wav",
  hotspot: "/cottage/audio/system/hotspot.wav",
  error: "/cottage/audio/system/error.wav",
};

function readStoredVolume() {
  const stored = localStorage.getItem(SFX_VOLUME_KEY);
  if (stored !== null) {
    const value = Number(stored);
    return Number.isFinite(value) && value > 0 ? Math.max(0, Math.min(1, value)) : DEFAULT_SFX_VOLUME;
  }

  const legacyStored = localStorage.getItem(LEGACY_SFX_VOLUME_KEY);
  if (legacyStored !== null) {
    const value = Number(legacyStored);
    return Number.isFinite(value) && value > 0.02 ? Math.max(0, Math.min(1, value)) : DEFAULT_SFX_VOLUME;
  }

  return DEFAULT_SFX_VOLUME;
}

function getPlaybackVolume(kind: SfxKind, volume: number) {
  const normalized = Math.max(0, Math.min(1, volume));
  if (kind === "hover") return Math.min(0.42, normalized * 0.58);
  return normalized;
}

async function unlockAudioElement(audio: HTMLAudioElement) {
  const previousVolume = audio.volume;
  try {
    audio.volume = 0;
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
  } catch {
    // The next direct click can still unlock audio in strict browsers.
  } finally {
    audio.volume = previousVolume;
  }
}

function clampVolume(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.max(0, Math.min(1, value)) : DEFAULT_SFX_VOLUME;
}

function readEventVolume(event: Event) {
  const volume = Number((event as CustomEvent<{ volume?: number }>).detail?.volume);
  if (Number.isFinite(volume)) return clampVolume(volume);
  return readStoredVolume();
}

function getInteractiveElement(target: EventTarget | null, selector: string) {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(selector);
}

function isDisabledElement(element: HTMLElement) {
  if (element.getAttribute("aria-disabled") === "true") return true;
  return element instanceof HTMLButtonElement && element.disabled;
}

function getExplicitSfxKind(element: HTMLElement): SfxKind | null {
  const value = element.dataset.sfx;
  return value === "hover" || value === "confirm" || value === "hotspot" || value === "error"
    ? value
    : null;
}

function shouldUseErrorSound(element: HTMLElement) {
  const label = [
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.textContent,
  ].filter(Boolean).join(" ");

  return /cancel|close|back|discard|dismiss|delete|remove|clear|danger|取消|关闭|收起|返回|放弃|删除|清空|移除/i.test(label);
}

export function SystemSfx() {
  const audioRef = useRef<Record<SfxKind, HTMLAudioElement> | null>(null);
  const volumeRef = useRef(DEFAULT_SFX_VOLUME);
  const unlockedRef = useRef(false);
  const lastHoverElementRef = useRef<HTMLElement | null>(null);
  const lastHoverAtRef = useRef(0);

  useEffect(() => {
    volumeRef.current = readStoredVolume();
    audioRef.current = Object.fromEntries(
      Object.entries(SFX_SOURCES).map(([kind, src]) => {
        const audio = new Audio(src);
        audio.preload = "auto";
        audio.volume = getPlaybackVolume(kind as SfxKind, volumeRef.current);
        return [kind, audio];
      }),
    ) as Record<SfxKind, HTMLAudioElement>;

    const play = (kind: SfxKind) => {
      const baseAudio = audioRef.current?.[kind];
      if (!baseAudio || volumeRef.current <= 0) return;

      const audio = baseAudio.cloneNode(true) as HTMLAudioElement;
      audio.volume = getPlaybackVolume(kind, volumeRef.current);
      audio.play().catch(() => {
        // Browsers can block audio before the first user gesture.
      });
    };

    const unlockAudio = () => {
      if (unlockedRef.current) return;
      unlockedRef.current = true;
      Object.values(audioRef.current ?? {}).forEach((audio) => {
        void unlockAudioElement(audio);
      });
    };

    const handleVolumeChange = (event: Event) => {
      volumeRef.current = readEventVolume(event);
    };

    const handlePointerOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const element = getInteractiveElement(event.target, HOVER_SELECTOR);
      if (!element || isDisabledElement(element)) return;
      if (element === lastHoverElementRef.current) return;

      const now = window.performance.now();
      if (now - lastHoverAtRef.current < 140) return;

      lastHoverElementRef.current = element;
      lastHoverAtRef.current = now;
      play("hover");
    };

    const handlePointerOut = (event: PointerEvent) => {
      const element = getInteractiveElement(event.target, HOVER_SELECTOR);
      if (element && element === lastHoverElementRef.current) {
        lastHoverElementRef.current = null;
      }
    };

    const handleClick = (event: MouseEvent) => {
      const element = getInteractiveElement(event.target, INTERACTIVE_SELECTOR);
      if (!element) return;

      if (isDisabledElement(element)) {
        play("error");
        return;
      }

      play(getExplicitSfxKind(element) || (shouldUseErrorSound(element) ? "error" : "confirm"));
    };

    const handleContextMenu = () => {
      play("error");
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") play("error");
    };

    const handleInvalid = () => {
      play("error");
    };

    VOLUME_CHANGE_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, handleVolumeChange as EventListener);
    });
    document.addEventListener("pointerdown", unlockAudio, true);
    document.addEventListener("pointerover", handlePointerOver, true);
    document.addEventListener("pointerout", handlePointerOut, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("contextmenu", handleContextMenu, true);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("invalid", handleInvalid, true);

    return () => {
      VOLUME_CHANGE_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, handleVolumeChange as EventListener);
      });
      document.removeEventListener("pointerdown", unlockAudio, true);
      document.removeEventListener("pointerover", handlePointerOver, true);
      document.removeEventListener("pointerout", handlePointerOut, true);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("contextmenu", handleContextMenu, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("invalid", handleInvalid, true);
    };
  }, []);

  return null;
}
