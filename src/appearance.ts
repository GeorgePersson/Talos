import {
  DEFAULT_APPEARANCE,
  type Appearance,
  type Command,
  type WorkspaceState,
} from "./shared";

function luminance(hex: string) {
  const rgb = hex
    .slice(1)
    .match(/../g)!
    .map((value) => {
      const channel = parseInt(value, 16) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function apply(palette: Appearance) {
  const root = document.documentElement;
  root.style.setProperty("--background", palette.background);
  root.style.setProperty("--foreground", palette.text);
  root.style.setProperty("--green", palette.accent);
  root.style.setProperty(
    "--accent-ink",
    luminance(palette.accent) > 0.179 ? "#000000" : "#ffffff",
  );
  root.style.colorScheme =
    luminance(palette.background) > 0.179 ? "light" : "dark";
}

export function initAppearance(run: (command: Command) => Promise<boolean>) {
  const input = (id: string) => document.getElementById(id) as HTMLInputElement;
  const status = document.getElementById("appearance-status")!;
  let open = false;
  let draft = { ...DEFAULT_APPEARANCE };
  const sync = () => {
    for (const key of ["background", "text", "accent"] as const) {
      input(`colour-${key}`).value = draft[key];
      input(`hex-${key}`).value = draft[key];
    }
    apply(draft);
  };
  for (const key of ["background", "text", "accent"] as const) {
    const picker = input(`colour-${key}`);
    const hex = input(`hex-${key}`);
    picker.oninput = () => {
      draft[key] = picker.value;
      hex.value = picker.value;
      status.textContent = "Unsaved changes";
      apply(draft);
    };
    hex.oninput = () => {
      status.textContent = "Unsaved changes";
      if (/^#[\da-f]{6}$/i.test(hex.value)) {
        draft[key] = hex.value.toLowerCase();
        picker.value = draft[key];
        apply(draft);
      }
    };
  }
  document.getElementById("appearance-form")!.onsubmit = async (event) => {
    event.preventDefault();
    if (await run({ type: "appearance", appearance: { ...draft } }))
      status.textContent = "Colours saved";
  };
  document.getElementById("reset-appearance")!.onclick = () => {
    draft = { ...DEFAULT_APPEARANCE };
    sync();
    status.textContent = "Default palette restored · Save to keep it";
  };
  document.getElementById("close-settings")!.onclick = () => {
    void run({ type: "settings", open: false });
  };
  document.addEventListener("keydown", (event) => {
    if (
      open &&
      event.key === "Escape" &&
      !(document.getElementById("dialog") as HTMLDialogElement).open
    ) {
      event.preventDefault();
      void run({ type: "settings", open: false });
    }
  });
  return {
    render(state: WorkspaceState) {
      const nextOpen = !!state.settingsOpen;
      if (nextOpen && !open) {
        draft = { ...state.appearance };
        sync();
        status.textContent = "";
      }
      if (!nextOpen) apply(state.appearance);
      document.getElementById("settings-page")!.hidden = !nextOpen;
      document.body.classList.toggle("settings-open", nextOpen);
      document
        .getElementById("settings")!
        .setAttribute("aria-pressed", String(nextOpen));
      if (nextOpen && !open) {
        (document.getElementById("find-bar") as HTMLElement).hidden = true;
        document.getElementById("close-settings")!.focus();
      }
      if (!nextOpen && open) document.getElementById("settings")!.focus();
      open = nextOpen;
    },
  };
}
