import { clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// 프로젝트 토큰 클래스를 알려 준다. 모르면 text-body를 글자색으로 보고 text-primary-foreground와 합칠 때 지운다.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      borderRadius: ["control", "card", "pill"],
    },
    classGroups: {
      "font-size": [{ text: ["display", "title", "body", "caption", "micro"] }],
      shadow: [{ shadow: ["popover", "dialog"] }],
      z: [{ z: ["canvas", "labels", "hud", "rail", "modal"] }],
      duration: [{ duration: ["micro", "state", "surface"] }],
    },
  },
});

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
