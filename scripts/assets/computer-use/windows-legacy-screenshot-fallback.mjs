import { execFile } from "node:child_process";
import { release } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const FALLBACK_SCREENSHOT_ID_PREFIX = "codex-gdi-";
const FIRST_BORDER_API_BUILD = 20348;
const CAPTURE_HELPER_PATH = fileURLToPath(
  new URL("../bin/windows/codex-gdi-capture.exe", import.meta.url),
);
const NATIVE_CAPTURE_FAILURE =
  /FrameArrived timed out|window capture timed out|no screenshot targets found|SetIsBorderRequired failed/i;
let nextScreenshotId = 1;

export function getWindowsBuildNumber(releaseValue = release()) {
  const build = Number(String(releaseValue).split(".")[2]);
  return Number.isInteger(build) ? build : null;
}

export function shouldPreferLegacyScreenshotFallback(releaseValue = release()) {
  const build = getWindowsBuildNumber(releaseValue);
  return build != null && build < FIRST_BORDER_API_BUILD;
}

export function isLegacyScreenshotId(value) {
  return (
    typeof value === "string" &&
    value.startsWith(FALLBACK_SCREENSHOT_ID_PREFIX)
  );
}

export function withoutLegacyScreenshotId(input) {
  if (!isLegacyScreenshotId(input?.screenshotId)) return input;
  const { screenshotId: _ignored, ...rest } = input;
  return rest;
}

export function isNativeCaptureFailure(error) {
  return NATIVE_CAPTURE_FAILURE.test(formatErrorMessage(error));
}

export async function captureWindowWithLegacyHelper(window) {
  const id = normalizeWindowId(window?.id);
  let stdout;
  try {
    ({ stdout } = await execFileAsync(CAPTURE_HELPER_PATH, [String(id)], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 15_000,
      windowsHide: true,
    }));
  } catch (error) {
    const detail = String(error?.stderr ?? "").trim();
    throw new Error(
      `Legacy Windows screenshot helper failed: ${
        detail || formatErrorMessage(error)
      }`,
      { cause: error },
    );
  }

  let capture;
  try {
    capture = JSON.parse(stdout);
  } catch (error) {
    throw new Error("Legacy Windows screenshot helper returned invalid JSON", {
      cause: error,
    });
  }
  if (
    typeof capture?.url !== "string" ||
    !capture.url.startsWith("data:image/png;base64,") ||
    !Number.isFinite(capture.width) ||
    !Number.isFinite(capture.height)
  ) {
    throw new Error("Legacy Windows screenshot helper returned invalid image data");
  }
  return capture;
}

export function installWindowsLegacyScreenshotFallback(
  client,
  {
    captureWindow = captureWindowWithLegacyHelper,
    emitImage = emitComputerUseImage,
    releaseValue = release(),
  } = {},
) {
  const nativeGetWindowState = client.get_window_state;
  const nativeClick = client.click;
  const nativeScroll = client.scroll;
  const nativeDrag = client.drag;
  const preferFallback = shouldPreferLegacyScreenshotFallback(releaseValue);

  client.get_window_state = async (input) => {
    const includeScreenshot = input?.include_screenshot !== false;
    if (!includeScreenshot) return nativeGetWindowState(input);

    if (preferFallback) {
      try {
        return await getFallbackWindowState({
          captureWindow,
          client,
          emitImage,
          input,
          nativeGetWindowState,
        });
      } catch (fallbackError) {
        try {
          return await nativeGetWindowState(input);
        } catch (nativeError) {
          throw combinedCaptureError(nativeError, fallbackError);
        }
      }
    }

    try {
      return await nativeGetWindowState(input);
    } catch (nativeError) {
      if (!isNativeCaptureFailure(nativeError)) throw nativeError;
      try {
        return await getFallbackWindowState({
          captureWindow,
          client,
          emitImage,
          input,
          nativeGetWindowState,
        });
      } catch (fallbackError) {
        throw combinedCaptureError(nativeError, fallbackError);
      }
    }
  };

  client.click = (input) => nativeClick(withoutLegacyScreenshotId(input));
  client.scroll = (input) => nativeScroll(withoutLegacyScreenshotId(input));
  client.drag = (input) => nativeDrag(withoutLegacyScreenshotId(input));
  return client;
}

async function getFallbackWindowState({
  captureWindow,
  client,
  emitImage,
  input,
  nativeGetWindowState,
}) {
  const includeText = input?.include_text === true;
  let accessibility = null;
  let window;

  if (includeText) {
    const textState = await nativeGetWindowState({
      ...input,
      include_screenshot: false,
      include_text: true,
    });
    accessibility = textState.accessibility;
    window = textState.window;
  } else {
    window = await client.get_window(input?.window);
  }

  const capture = await captureWindow(window);
  const screenshot = {
    id: `${FALLBACK_SCREENSHOT_ID_PREFIX}${Date.now()}-${nextScreenshotId++}`,
    zIndex: 0,
    url: capture.url,
  };
  assignFiniteNumber(screenshot, "originX", capture.originX);
  assignFiniteNumber(screenshot, "originY", capture.originY);
  assignFiniteNumber(screenshot, "width", capture.width);
  assignFiniteNumber(screenshot, "height", capture.height);
  await emitImage(screenshot.url);
  return { accessibility, screenshots: [screenshot], window };
}

async function emitComputerUseImage(url) {
  if (typeof globalThis.nodeRepl?.emitImage === "function") {
    await globalThis.nodeRepl.emitImage(url);
    return;
  }
  if (typeof globalThis.codex?.emitImage === "function") {
    await globalThis.codex.emitImage({
      type: "input_image",
      image_url: url,
      detail: "original",
    });
  }
}

function combinedCaptureError(nativeError, fallbackError) {
  return new Error(
    `Windows screenshot capture failed (native: ${formatErrorMessage(
      nativeError,
    )}; fallback: ${formatErrorMessage(fallbackError)})`,
    { cause: fallbackError },
  );
}

function assignFiniteNumber(target, key, value) {
  if (Number.isFinite(value)) target[key] = value;
}

function normalizeWindowId(value) {
  const id = typeof value === "string" ? Number(value) : value;
  if (!Number.isInteger(id) || id < 0) {
    throw new TypeError("window.id must be an integer >= 0");
  }
  return id;
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
