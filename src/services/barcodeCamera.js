import { BrowserMultiFormatReader } from "@zxing/browser";

export const cameraMessages = {
  permission: "تم رفض إذن الكاميرا. فعّل إذن الكاميرا من إعدادات المتصفح.",
  noCamera: "لم يتم العثور على كاميرا متاحة.",
  secureContext: "تحتاج الكاميرا إلى اتصال آمن (HTTPS) أو localhost.",
  generic: "تعذر تشغيل ماسح الباركود بالكاميرا. استخدم جهاز الباركود أو الإدخال اليدوي.",
  ready: "اضغط تشغيل المسح لمنح إذن الكاميرا.",
  running: "الكاميرا تعمل — وجّهها نحو الباركود.",
  stopped: "تم إيقاف الكاميرا.",
};

const errorMessage = (error) => {
  if (["NotAllowedError", "PermissionDeniedError"].includes(error?.name)) return cameraMessages.permission;
  if (["NotFoundError", "DevicesNotFoundError"].includes(error?.name)) return cameraMessages.noCamera;
  if (["NotSupportedError", "SecurityError"].includes(error?.name)) return cameraMessages.secureContext;
  return cameraMessages.generic;
};

const nativeFormats = ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "qr_code"];

export const createBarcodeCameraController = ({ video, onFound, onState }) => {
  let active = null;
  const stop = () => {
    if (!active) return;
    active.stopped = true;
    if (active.timer) clearInterval(active.timer);
    active.timer = null;
    active.controls?.stop?.();
    active.controls = null;
    active.stream?.getTracks?.().forEach((track) => track.stop());
    active.stream = null;
    if (video) video.srcObject = null;
    active = null;
  };
  const start = async () => {
    stop();
    const session = { stopped: false, delivered: false, timer: null, controls: null, stream: null };
    active = session;
    const valid = () => active === session && !session.stopped;
    const deliver = (rawValue) => {
      const value = String(rawValue ?? "").trim();
      if (!value || !valid() || session.delivered) return;
      session.delivered = true;
      stop();
      onFound(value);
    };
    try {
      if (!window.isSecureContext && window.location.hostname !== "localhost") throw Object.assign(new Error(), { name: "SecurityError" });
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error(), { name: "NotSupportedError" });
      if ("BarcodeDetector" in window) {
        try {
          const supported = typeof window.BarcodeDetector.getSupportedFormats === "function" ? await window.BarcodeDetector.getSupportedFormats() : [];
          const formats = supported.length ? nativeFormats.filter((format) => supported.includes(format)) : undefined;
          session.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
          if (!valid()) return;
          video.srcObject = session.stream;
          await video.play();
          const detector = new window.BarcodeDetector(formats?.length ? { formats } : undefined);
          onState(cameraMessages.running);
          session.timer = setInterval(async () => {
            if (!valid() || session.delivered || session.detecting) return;
            session.detecting = true;
            try {
              const codes = await detector.detect(video);
              if (codes[0]?.rawValue) deliver(codes[0].rawValue);
            } catch {
              // Ignore transient native detection errors and keep scanning.
            } finally {
              session.detecting = false;
            }
          }, 350);
          return;
        } catch {
          // Native initialization failed; try ZXing below.
          stop();
          session.stopped = false;
          active = session;
        }
      }
      const reader = new BrowserMultiFormatReader();
      session.controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } }, audio: false }, video, (result) => {
        if (result?.getText) deliver(result.getText());
      });
      if (valid()) onState(cameraMessages.running);
    } catch (error) {
      if (active === session) {
        stop();
        onState(errorMessage(error));
      }
    }
  };
  return { start, stop };
};
