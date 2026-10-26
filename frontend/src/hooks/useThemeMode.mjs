import { useEffect, useState } from "react";

// 설정의 테마(라이트·시스템·다크)를 <html data-theme>와 color-scheme에 건다. 시스템은 지금의 prefers-color-scheme을 따른다.
export function useThemeMode() {
  const [themeMode, setThemeMode] = useState("system");

  useEffect(() => {
    let activeTheme = themeMode;
    if (themeMode === "system") {
      activeTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.dataset.theme = activeTheme;
    document.documentElement.style.colorScheme = activeTheme;
  }, [themeMode]);

  return [themeMode, setThemeMode];
}
