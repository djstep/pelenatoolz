"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CitySearchResult } from "@/features/projects/lib/city-geocoding";
import {
  resolveCurrency,
  searchCurrencies,
} from "@/features/projects/lib/currencies";
import {
  resolveTimezone,
  searchTimezones,
} from "@/features/projects/lib/timezones";
import { AutocompleteInput } from "@/shared/ui/autocomplete-input";
import { Label } from "@/shared/ui/label";

type Props = {
  initialCity?: string;
  initialCurrency?: string;
  initialTimezone?: string;
  disabled?: boolean;
  currencyLabelText?: string;
  timezoneLabelText?: string;
  cityLabelText?: string;
};

export function ProjectLocationFields({
  initialCity = "",
  initialCurrency = "RUB",
  initialTimezone = "Europe/Moscow",
  disabled = false,
  cityLabelText = "Город",
  currencyLabelText = "Валюта",
  timezoneLabelText = "Часовой пояс",
}: Props) {
  const [city, setCity] = useState(initialCity);
  const [currency, setCurrency] = useState(initialCurrency);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [cityQuery, setCityQuery] = useState(initialCity);
  const [currencyQuery, setCurrencyQuery] = useState(initialCurrency);
  const [timezoneQuery, setTimezoneQuery] = useState(initialTimezone);
  const [cityOptions, setCityOptions] = useState<CitySearchResult[]>([]);
  const [cityLoading, setCityLoading] = useState(false);
  const currencyTouched = useRef(false);
  const timezoneTouched = useRef(false);

  useEffect(() => {
    const trimmed = cityQuery.trim();
    if (trimmed.length < 2) {
      setCityOptions([]);
      setCityLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setCityLoading(true);
      try {
        const response = await fetch(
          `/api/geocoding/cities?q=${encodeURIComponent(trimmed)}&limit=10`,
          { signal: controller.signal },
        );
        if (!response.ok) {
          setCityOptions([]);
          return;
        }
        const json = (await response.json()) as { results?: CitySearchResult[] };
        setCityOptions(json.results ?? []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setCityOptions([]);
        }
      } finally {
        setCityLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [cityQuery]);

  const cityAutocompleteOptions = useMemo(
    () =>
      cityOptions.map((place) => ({
        value: place.label,
        label: place.label,
        hint: [place.timezone, place.currency].filter(Boolean).join(" · "),
      })),
    [cityOptions],
  );

  const currencyAutocompleteOptions = useMemo(
    () =>
      searchCurrencies(currencyQuery).map((option) => ({
        value: option.value,
        label: option.label,
      })),
    [currencyQuery],
  );

  const timezoneAutocompleteOptions = useMemo(
    () =>
      searchTimezones(timezoneQuery).map((option) => ({
        value: option.value,
        label: option.label,
      })),
    [timezoneQuery],
  );

  function handleCitySelect(option: { value: string }) {
    const place = cityOptions.find((item) => item.label === option.value);
    if (!place) return;

    setCity(place.label);
    setCityQuery(place.label);

    if (place.timezone && !timezoneTouched.current) {
      setTimezone(place.timezone);
      setTimezoneQuery(place.timezone);
    }

    if (place.currency && !currencyTouched.current) {
      setCurrency(place.currency);
      setCurrencyQuery(place.currency);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <Label htmlFor="city">{cityLabelText}</Label>
        <AutocompleteInput
          id="city"
          name="city"
          value={city}
          placeholder="Москва"
          disabled={disabled}
          loading={cityLoading}
          minChars={2}
          options={cityAutocompleteOptions}
          onValueChange={(next) => {
            setCity(next);
            setCityQuery(next);
          }}
          onQueryChange={setCityQuery}
          onSelect={handleCitySelect}
        />
      </div>

      <div>
        <Label htmlFor="currency">{currencyLabelText}</Label>
        <AutocompleteInput
          id="currency"
          name="currency"
          value={currency}
          placeholder="RUB"
          disabled={disabled}
          minChars={1}
          options={currencyAutocompleteOptions}
          onValueChange={(next) => {
            currencyTouched.current = true;
            setCurrency(next.toUpperCase());
            setCurrencyQuery(next.toUpperCase());
          }}
          onQueryChange={(next) => {
            currencyTouched.current = true;
            setCurrencyQuery(next.toUpperCase());
          }}
          onSelect={(option) => {
            currencyTouched.current = true;
            setCurrency(option.value);
            setCurrencyQuery(option.value);
          }}
          onBlurNormalize={(next) => resolveCurrency(next)}
        />
      </div>

      <div>
        <Label htmlFor="timezone">{timezoneLabelText}</Label>
        <AutocompleteInput
          id="timezone"
          name="timezone"
          value={timezone}
          placeholder="Europe/Moscow"
          disabled={disabled}
          minChars={1}
          options={timezoneAutocompleteOptions}
          onValueChange={(next) => {
            timezoneTouched.current = true;
            setTimezone(next);
            setTimezoneQuery(next);
          }}
          onQueryChange={(next) => {
            timezoneTouched.current = true;
            setTimezoneQuery(next);
          }}
          onSelect={(option) => {
            timezoneTouched.current = true;
            setTimezone(option.value);
            setTimezoneQuery(option.value);
          }}
          onBlurNormalize={(next) => resolveTimezone(next)}
        />
      </div>
    </div>
  );
}
