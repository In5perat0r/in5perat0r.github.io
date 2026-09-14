(function () {
  const runBtn = document.getElementById("run-scan");
  const copyBtn = document.getElementById("copy-log");
  const logEl = document.getElementById("log");

  let lastReportText = "";

  // ---- helpers ---------------------------------------------------------

  function safe(fn, fallback) {
    try {
      const value = fn();
      return value === undefined || value === null || value === "" ? (fallback ?? "n/a") : value;
    } catch (e) {
      return fallback ?? "n/a";
    }
  }

  function safeBool(fn) {
    try {
      return !!fn();
    } catch (e) {
      return false;
    }
  }

  async function safeAsync(fn, fallback) {
    try {
      const value = await fn();
      return value === undefined || value === null || value === "" ? (fallback ?? "n/a") : value;
    } catch (e) {
      return fallback ?? "n/a";
    }
  }

  function guessEngine(ua) {
    ua = ua.toLowerCase();
    if (ua.includes("firefox") || ua.includes("gecko/")) return "Gecko (Firefox-family)";
    if (ua.includes("edg/")) return "Blink (Chromium/Edge)";
    if (ua.includes("chrome/") || ua.includes("chromium/") || ua.includes("crios")) return "Blink (Chromium-family)";
    if (ua.includes("applewebkit") && ua.includes("safari") && !ua.includes("chrome")) return "WebKit (Safari-family)";
    if (typeof window.chrome !== "undefined") return "Likely Blink";
    return "Unknown / could not determine";
  }

  function bytesToHuman(bytes) {
    if (typeof bytes !== "number" || isNaN(bytes)) return "n/a";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
      bytes /= 1024;
      i++;
    }
    return bytes.toFixed(1) + " " + units[i];
  }

  function testWebPSupport() {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      return canvas.toDataURL("image/webp").indexOf("data:image/webp") === 0;
    } catch (e) {
      return false;
    }
  }

  function testAvifSupport() {
    return new Promise((resolve) => {
      const img = new Image();
      const timeout = setTimeout(() => resolve(false), 500);
      img.onload = () => { clearTimeout(timeout); resolve(img.width > 0); };
      img.onerror = () => { clearTimeout(timeout); resolve(false); };
      img.src = "data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAABcAAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQAMAAAAABNjb2xybmNseAACAAIABoAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAAB9tZGF0EgAKCBgABogQEDQgMgkQAAAAB8dSLfI=";
    });
  }

  function getWebGLInfo(version) {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext(version) || canvas.getContext("experimental-" + version);
      if (!gl) return null;
      const info = {
        version: safe(() => gl.getParameter(gl.VERSION)),
        shadingLanguageVersion: safe(() => gl.getParameter(gl.SHADING_LANGUAGE_VERSION)),
        vendor: safe(() => gl.getParameter(gl.VENDOR)),
        renderer: safe(() => gl.getParameter(gl.RENDERER)),
      };
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      if (dbg) {
        info.unmaskedVendor = safe(() => gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL));
        info.unmaskedRenderer = safe(() => gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
      }
      return info;
    } catch (e) {
      return null;
    }
  }

  // ---- data collection ---------------------------------------------------

  async function collectReport() {
    const ua = safe(() => navigator.userAgent, "unavailable");
    const uaData = navigator.userAgentData;

    let highEntropy = null;
    if (uaData && typeof uaData.getHighEntropyValues === "function") {
      try {
        highEntropy = await uaData.getHighEntropyValues([
          "platformVersion", "architecture", "bitness", "model", "uaFullVersion", "fullVersionList"
        ]);
      } catch (e) {
        highEntropy = null;
      }
    }

    const identity = {
      "User agent": ua,
      "Engine (best guess)": guessEngine(ua),
      "Vendor": safe(() => navigator.vendor),
      "App name / code name": safe(() => navigator.appName) + " / " + safe(() => navigator.appCodeName),
      "Build ID (Firefox only)": safe(() => navigator.buildID),
      "UA-CH brands": uaData ? safe(() => uaData.brands.map(b => b.brand + " " + b.version).join(", ")) : "not supported",
      "UA-CH mobile": uaData ? safeBool(() => uaData.mobile) : "not supported",
      "UA-CH platform": uaData ? safe(() => uaData.platform) : "not supported",
      "UA-CH architecture": highEntropy ? safe(() => highEntropy.architecture) : "n/a",
      "UA-CH bitness": highEntropy ? safe(() => highEntropy.bitness) : "n/a",
      "UA-CH platform version": highEntropy ? safe(() => highEntropy.platformVersion) : "n/a",
      "UA-CH full version": highEntropy ? safe(() => highEntropy.uaFullVersion) : "n/a",
    };

    const hardware = {
      "Platform string": safe(() => navigator.platform),
      "OS CPU (Firefox only)": safe(() => navigator.oscpu),
      "Logical CPU cores": safe(() => navigator.hardwareConcurrency),
      "Device memory (Chromium, approx.)": navigator.deviceMemory ? navigator.deviceMemory + " GB" : "not exposed",
      "Max touch points": safe(() => navigator.maxTouchPoints),
      "Touch events supported": safeBool(() => "ontouchstart" in window),
      "Coarse pointer (touch-like)": safeBool(() => window.matchMedia("(pointer: coarse)").matches),
      "Fine pointer (mouse-like)": safeBool(() => window.matchMedia("(pointer: fine)").matches),
    };

    const display = {
      "Screen size": safe(() => screen.width + " x " + screen.height),
      "Available screen size": safe(() => screen.availWidth + " x " + screen.availHeight),
      "Color depth": safe(() => screen.colorDepth + "-bit"),
      "Device pixel ratio": safe(() => window.devicePixelRatio),
      "Viewport (inner)": safe(() => window.innerWidth + " x " + window.innerHeight),
      "Outer window size": safe(() => window.outerWidth + " x " + window.outerHeight),
      "Orientation": safe(() => screen.orientation && screen.orientation.type),
      "Prefers dark color scheme": safeBool(() => window.matchMedia("(prefers-color-scheme: dark)").matches),
      "Prefers reduced motion": safeBool(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches),
    };

    const locale = {
      "Primary language": safe(() => navigator.language),
      "All languages": safe(() => navigator.languages && navigator.languages.join(", ")),
      "Timezone (IANA)": safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
      "Resolved locale": safe(() => Intl.DateTimeFormat().resolvedOptions().locale),
      "UTC offset (minutes)": safe(() => new Date().getTimezoneOffset() * -1),
    };

    const network = {
      "Online": safeBool(() => navigator.onLine),
      "Connection type": safe(() => navigator.connection && navigator.connection.effectiveType),
      "Downlink (Mbps, approx.)": safe(() => navigator.connection && navigator.connection.downlink),
      "Round-trip time (ms, approx.)": safe(() => navigator.connection && navigator.connection.rtt),
      "Data saver enabled": navigator.connection ? safeBool(() => navigator.connection.saveData) : "not supported",
    };

    let storageEstimate = null;
    if (navigator.storage && typeof navigator.storage.estimate === "function") {
      try {
        storageEstimate = await navigator.storage.estimate();
      } catch (e) {
        storageEstimate = null;
      }
    }
    let persisted = null;
    if (navigator.storage && typeof navigator.storage.persisted === "function") {
      try {
        persisted = await navigator.storage.persisted();
      } catch (e) {
        persisted = null;
      }
    }

    let localStorageWorks = false;
    try {
      localStorage.setItem("__diag_test__", "1");
      localStorage.removeItem("__diag_test__");
      localStorageWorks = true;
    } catch (e) {
      localStorageWorks = false;
    }

    const storage = {
      "Cookies enabled": safeBool(() => navigator.cookieEnabled),
      "localStorage usable": localStorageWorks,
      "indexedDB supported": safeBool(() => "indexedDB" in window),
      "Storage already persisted": persisted === null ? "n/a" : !!persisted,
      "Storage quota (estimate)": storageEstimate ? bytesToHuman(storageEstimate.quota) : "n/a",
      "Storage used (estimate)": storageEstimate ? bytesToHuman(storageEstimate.usage) : "n/a",
    };

    const webgl1 = getWebGLInfo("webgl");
    const webgl2 = getWebGLInfo("webgl2");
    const avifSupported = await testAvifSupport();

    const graphics = {
      "Canvas 2D supported": safeBool(() => !!document.createElement("canvas").getContext("2d")),
      "WebGL supported": !!webgl1,
      "WebGL renderer": webgl1 ? (webgl1.unmaskedRenderer || webgl1.renderer) : "n/a",
      "WebGL vendor": webgl1 ? (webgl1.unmaskedVendor || webgl1.vendor) : "n/a",
      "WebGL2 supported": !!webgl2,
      "WebGPU supported": safeBool(() => "gpu" in navigator),
      "WebP image support": testWebPSupport(),
      "AVIF image support": avifSupported,
    };

    const featureChecks = [
      ["Service Worker", () => "serviceWorker" in navigator],
      ["Web Workers", () => typeof Worker !== "undefined"],
      ["SharedArrayBuffer", () => typeof SharedArrayBuffer !== "undefined"],
      ["WebAssembly", () => typeof WebAssembly === "object"],
      ["Geolocation API present", () => "geolocation" in navigator],
      ["Notifications API present", () => "Notification" in window],
      ["Push API", () => "PushManager" in window],
      ["Clipboard API", () => "clipboard" in navigator],
      ["Web Share API", () => "share" in navigator],
      ["Web Bluetooth", () => "bluetooth" in navigator],
      ["WebUSB", () => "usb" in navigator],
      ["Web Serial", () => "serial" in navigator],
      ["WebHID", () => "hid" in navigator],
      ["Web NFC", () => "NDEFReader" in window],
      ["Payment Request API", () => "PaymentRequest" in window],
      ["Credential Management API", () => "credentials" in navigator],
      ["WebAuthn", () => "PublicKeyCredential" in window],
      ["Media Devices API", () => "mediaDevices" in navigator],
      ["WebRTC (RTCPeerConnection)", () => typeof RTCPeerConnection !== "undefined"],
      ["Battery API", () => "getBattery" in navigator],
      ["Vibration API", () => "vibrate" in navigator],
      ["Gamepad API", () => "getGamepads" in navigator],
      ["Fullscreen API", () => !!document.fullscreenEnabled],
      ["Pointer Lock", () => "pointerLockElement" in document],
      ["Page Visibility API", () => "visibilityState" in document],
      ["WebXR", () => "xr" in navigator],
      ["Screen Wake Lock", () => "wakeLock" in navigator],
      ["Idle Detection API", () => "IdleDetector" in window],
      ["File System Access API", () => "showOpenFilePicker" in window],
      ["Web Locks API", () => "locks" in navigator],
      ["Speech Synthesis", () => "speechSynthesis" in window],
      ["Speech Recognition", () => "SpeechRecognition" in window || "webkitSpeechRecognition" in window],
      ["EyeDropper API", () => "EyeDropper" in window],
      ["Web MIDI", () => "requestMIDIAccess" in navigator],
      ["CSS backdrop-filter", () => CSS.supports("backdrop-filter", "blur(1px)")],
      ["CSS Grid", () => CSS.supports("display", "grid")],
      ["CSS :has() selector", () => CSS.supports("selector(:has(a))")],
      ["CSS Container Queries", () => CSS.supports("container-type", "inline-size")],
    ];

    const features = {};
    featureChecks.forEach(([label, check]) => {
      features[label] = safeBool(check);
    });

    return {
      identity, hardware, display, locale, network, storage, graphics, features
    };
  }

  // ---- rendering ---------------------------------------------------------

  function renderSection(title, data) {
    const section = document.createElement("div");
    section.className = "log__section";

    const heading = document.createElement("h2");
    heading.className = "log__section-title";
    heading.textContent = title;
    section.appendChild(heading);

    Object.entries(data).forEach(([key, value]) => {
      const row = document.createElement("div");
      row.className = "log__row";

      const keyEl = document.createElement("span");
      keyEl.className = "log__key";
      keyEl.textContent = key;

      const valEl = document.createElement("span");
      valEl.className = "log__value";
      if (typeof value === "boolean") {
        valEl.textContent = value ? "yes" : "no";
        valEl.classList.add(value ? "log__value--yes" : "log__value--no");
      } else {
        valEl.textContent = String(value);
      }

      row.appendChild(keyEl);
      row.appendChild(valEl);
      section.appendChild(row);
    });

    return section;
  }

  function reportToText(report, scannedAt) {
    let lines = ["Diagnostics report - " + scannedAt, ""];
    const titles = {
      identity: "Browser & engine",
      hardware: "Hardware & platform",
      display: "Display",
      locale: "Locale & time",
      network: "Network",
      storage: "Storage",
      graphics: "Graphics",
      features: "Supported web APIs & CSS features",
    };
    Object.entries(titles).forEach(([key, title]) => {
      lines.push("== " + title + " ==");
      Object.entries(report[key]).forEach(([k, v]) => {
        lines.push(k + ": " + (typeof v === "boolean" ? (v ? "yes" : "no") : v));
      });
      lines.push("");
    });
    return lines.join("\n");
  }

  async function runScan() {
    runBtn.disabled = true;
    runBtn.textContent = "Scanning...";
    logEl.innerHTML = "";

    const report = await collectReport();
    const scannedAt = new Date().toLocaleString();

    const scannedAtEl = document.createElement("p");
    scannedAtEl.className = "log__scanned-at";
    scannedAtEl.textContent = "Scanned at " + scannedAt;
    logEl.appendChild(scannedAtEl);

    logEl.appendChild(renderSection("Browser & engine", report.identity));
    logEl.appendChild(renderSection("Hardware & platform", report.hardware));
    logEl.appendChild(renderSection("Display", report.display));
    logEl.appendChild(renderSection("Locale & time", report.locale));
    logEl.appendChild(renderSection("Network", report.network));
    logEl.appendChild(renderSection("Storage", report.storage));
    logEl.appendChild(renderSection("Graphics", report.graphics));
    logEl.appendChild(renderSection("Supported web APIs & CSS features", report.features));

    lastReportText = reportToText(report, scannedAt);
    copyBtn.disabled = false;

    runBtn.disabled = false;
    runBtn.textContent = "Run diagnostic scan";
  }

  runBtn.addEventListener("click", runScan);

  copyBtn.addEventListener("click", async function () {
    if (!lastReportText) return;
    try {
      await navigator.clipboard.writeText(lastReportText);
      const original = copyBtn.textContent;
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = original; }, 1500);
    } catch (e) {
      window.prompt("Copy the report manually:", lastReportText);
    }
  });
})();
