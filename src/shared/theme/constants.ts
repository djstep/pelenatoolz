export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "filmprod-theme";

export const themeScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var theme=t==="light"||t==="dark"?t:"dark";document.documentElement.setAttribute("data-theme",theme);}catch(e){document.documentElement.setAttribute("data-theme","dark");}})();`;
