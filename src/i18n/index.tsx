import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { governorateLabels, translations } from "./translations";
import type { Language, TranslationKey } from "./translations";

interface I18nValue {
  lang: Language;
  dir: "rtl" | "ltr";
  setLang: (lang: Language) => void;
  toggle: () => void;
  t: (key: TranslationKey) => string;
  gov: (name: string) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDateTime: (value: string | Date) => string;
  formatTime: (value: string | Date) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

const STORAGE_KEY = "syr-gis-lang";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>("ar");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "ar") setLangState(stored);
  }, []);

  const dir = lang === "ar" ? "rtl" : "ltr";

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const value = useMemo<I18nValue>(() => {
    const locale = lang === "ar" ? "ar-SY" : "en-GB";
    return {
      lang,
      dir,
      setLang,
      toggle: () => setLang(lang === "ar" ? "en" : "ar"),
      t: (key) => translations[lang][key] ?? key,
      gov: (name) => (lang === "ar" ? name : (governorateLabels[name] ?? name)),
      formatNumber: (v, options) => new Intl.NumberFormat(locale, options).format(v),
      formatDateTime: (v) =>
        new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(typeof v === "string" ? new Date(v) : v),
      formatTime: (v) =>
        new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(
          typeof v === "string" ? new Date(v) : v,
        ),
    };
  }, [lang, dir, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

export type { Language, TranslationKey };