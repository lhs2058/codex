import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

  useEffect(() => {
    if (profileLanguage) setLanguageState(profileLanguage);
  }, [profileLanguage]);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    void Promise.resolve(onLanguageChange?.(next)).catch(() => undefined);
  }, [onLanguageChange]);

  const value = useMemo<I18nValue>(() => ({
    language,
    setLanguage,
    t: (key, params) => translate(language, key, params),
  }), [language, setLanguage]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n(legacy?: Partial<Record<TranslationKey, string>>): I18nValue {
  const value = useContext(I18nContext);
  return value ?? {
    language: "ko",
    setLanguage: () => undefined,
    t: (key, params) => interpolate(legacy?.[key] ?? ko[key], params),
  };
}
