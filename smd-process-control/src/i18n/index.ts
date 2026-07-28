import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  createElement,
  type PropsWithChildren,
} from "react";
import { ko } from "./ko";
import { vi } from "./vi";

export type Language = "ko" | "vi";
export type TranslationKey = keyof typeof ko;
export type TranslationParams = Record<string, string | number>;

const dictionaries = { ko, vi } as const;

export function resolveBrowserLanguage(languages: readonly string[] = globalThis.navigator?.languages ?? []): Language {
  return languages.some((language) => language.toLowerCase().startsWith("vi")) ? "vi" : "ko";
}

function interpolate(value: string, params?: TranslationParams): string {
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match);
}

export function translate(language: Language, key: TranslationKey, params?: TranslationParams): string {
  return interpolate(dictionaries[language][key], params);
}

export function t(key: TranslationKey, params?: TranslationParams): string {
  return translate("ko", key, params);
}

interface I18nValue {
  error: boolean;
  language: Language;
  setLanguage(language: Language): void;
  t(key: TranslationKey, params?: TranslationParams): string;
}

const I18nContext = createContext<I18nValue | null>(null);

interface I18nProviderProps extends PropsWithChildren {
  profileLanguage?: Language;
  browserLanguages?: readonly string[];
  onLanguageChange?(language: Language): void | Promise<void>;
}

export function I18nProvider({
  profileLanguage,
  browserLanguages,
  onLanguageChange,
  children,
}: I18nProviderProps) {
  const [language, setLanguageState] = useState<Language>(
    profileLanguage ?? resolveBrowserLanguage(browserLanguages),
  );
  const [error, setError] = useState(false);
  const changeGeneration = useRef(0);

  useEffect(() => {
    if (profileLanguage) {
      setLanguageState(profileLanguage);
    }
  }, [profileLanguage]);

  const setLanguage = useCallback((next: Language) => {
    const previous = language;
    const generation = ++changeGeneration.current;
    setError(false);
    setLanguageState(next);
    void Promise.resolve().then(() => onLanguageChange?.(next)).catch(() => {
      if (generation !== changeGeneration.current) return;
      setLanguageState(previous);
      setError(true);
    });
  }, [language, onLanguageChange]);

  const value = useMemo<I18nValue>(() => ({
    error,
    language,
    setLanguage,
    t: (key, params) => translate(language, key, params),
  }), [error, language, setLanguage]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n(legacy?: Partial<Record<TranslationKey, string>>): I18nValue {
  const value = useContext(I18nContext);
  return value ?? {
    error: false,
    language: "ko",
    setLanguage: () => undefined,
    t: (key, params) => interpolate(legacy?.[key] ?? ko[key], params),
  };
}
