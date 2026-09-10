const SCROLL_DISTANCE = 600;

function stateText(state) {
  return state.accessibility?.tree || state.accessibility?.document_text || "";
}

function imageBytes(url) {
  const payload = String(url || "").split(",", 2)[1];
  if (!payload) throw new Error("Windows screenshot has no data URL payload");
  return Uint8Array.from(Buffer.from(payload, "base64"));
}

async function emitText(value, options) {
  if (options?.emit === false) return;
  await globalThis.nodeRepl?.write?.(value, "cua.state");
}

async function emitImage(bytes, options) {
  if (options?.emit === false) return;
  await globalThis.nodeRepl?.emitImage?.({ bytes, mimeType: "image/png" });
}

function matchingApp(apps, target) {
  const value = String(target || "").toLocaleLowerCase();
  return apps.find((app) =>
    [app.id, app.displayName].some((candidate) =>
      String(candidate || "").toLocaleLowerCase() === value,
    ),
  );
}

function requireWindow(app, target) {
  if (app?.windows?.length !== 1) {
    throw new Error(
      `Expected exactly one open window for ${target}; found ${app?.windows?.length || 0}`,
    );
  }
  return app.windows[0];
}

function scrollDelta(direction, pages) {
  const amount = SCROLL_DISTANCE * (pages ?? 1);
  switch (direction) {
    case "up": case "u": return { scrollX: 0, scrollY: -amount };
    case "down": case "d": return { scrollX: 0, scrollY: amount };
    case "left": case "l": return { scrollX: -amount, scrollY: 0 };
    case "right": case "r": return { scrollX: amount, scrollY: 0 };
    default: throw new Error(`Unsupported Windows scroll direction: ${direction}`);
  }
}

function bindWindow(computer, initialWindow) {
  let window = initialWindow;
  const observe = async ({ include_screenshot, include_text }) => {
    const state = await computer.get_window_state({ window, include_screenshot, include_text });
    window = state.window;
    return state;
  };
  const observeText = async (options) => {
    const state = await observe({ include_screenshot: false, include_text: true });
    const text = stateText(state);
    await emitText(text, options);
    return text;
  };
  const observeImage = async (options) => {
    const state = await observe({ include_screenshot: true, include_text: false });
    const screenshot = state.screenshots?.[0];
    if (!screenshot) throw new Error("Windows screenshot is unavailable");
    const bytes = imageBytes(screenshot.url);
    await emitImage(bytes, options);
    return bytes;
  };
  return {
    getAXState: observeText,
    getScreenshot: observeImage,
    async getAXStateAndScreenshot(options) {
      const state = await observe({ include_screenshot: true, include_text: true });
      const text = stateText(state);
      await emitText(text, options);
      const screenshot = state.screenshots?.[0];
      if (!screenshot) return { state: text };
      const bytes = imageBytes(screenshot.url);
      await emitImage(bytes, options);
      return { state: text, screenshot: bytes };
    },
    // Sky types text directly on Windows; formats have no native equivalent.
    paste: (text) => computer.type_text({ window, text }),
    click(target, options) {
      return computer.click({
        window,
        ...(Array.isArray(target) ? { x: target[0], y: target[1] } : { element_index: target }),
        ...(options?.mouseButton ? { mouse_button: options.mouseButton } : {}),
        ...(options?.clickCount ? { click_count: options.clickCount } : {}),
      });
    },
    drag: (from, to) => computer.drag({ window, from_x: from[0], from_y: from[1], to_x: to[0], to_y: to[1] }),
    pressKey: (key) => computer.press_key({ window, key }),
    scroll(target, direction, pages) {
      if (!Array.isArray(target)) throw new Error("Windows scrolling requires a window coordinate");
      return computer.scroll({ window, x: target[0], y: target[1], ...scrollDelta(direction, pages) });
    },
    setValue: (element_index, value) => computer.set_value({ window, element_index, value }),
    typeText: (text) => computer.type_text({ window, text }),
    performSecondaryAction: (element_index, action) => computer.perform_secondary_action({ window, element_index, action }),
    selectText() {
      throw new Error("Windows Sky does not support selectText");
    },
  };
}

export async function installWindowsAppBindings(cua) {
  const computer = cua?.computer;
  if (computer?.target !== "windows") return cua;
  cua.listApps = async (options) => {
    const apps = await computer.list_apps();
    await emitText(JSON.stringify(apps), options);
    return apps;
  };
  cua.getApp = async (target) => {
    let apps = await computer.list_apps();
    let app = matchingApp(apps, target);
    if (!app || app.windows?.length === 0) {
      await computer.launch_app({ app: app?.id || target });
      apps = await computer.list_apps();
      app = matchingApp(apps, target);
    }
    if (!app) throw new Error(`Windows app not found: ${target}`);
    const candidate = requireWindow(app, target);
    const window = await computer.get_window({ app: candidate.app, id: candidate.id });
    const binding = bindWindow(computer, window);
    await binding.getAXStateAndScreenshot({ disableDiffing: true });
    return binding;
  };
  return cua;
}
