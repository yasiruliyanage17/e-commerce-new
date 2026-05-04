import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";
import { dmsService } from "../services/dmsService";
import { QRCodeCanvas } from "qrcode.react";

export default function DmsQrScanner() {
  const scannerRef = useRef(null);
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [cameraActive, setCameraActive] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [manualQrText, setManualQrText] = useState("");
  const [lastResult, setLastResult] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const isSecure = window.isSecureContext || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  const stopCamera = useCallback(async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
      } catch (err) {
        console.error("Failed to stop scanner:", err);
      }
      scannerRef.current = null;
    }
    setCameraActive(false);
  }, []);

  const submitQr = useCallback(
    async (rawQrText, source = "manual") => {
      const qrText = `${rawQrText || ""}`.trim();
      if (!qrText || scanBusy) {
        return;
      }

      setScanBusy(true);
      setError("");
      setSuccess("");

      try {
        const result = await dmsService.scanSellerQr({
          qrText,
          notes:
            source === "camera"
              ? "Scanned from delivery center camera reader."
              : "Submitted from delivery center manual reader.",
          metadata: {
            source,
          },
        });

        setLastResult(result);
        setManualQrText(qrText);
        setSuccess(result?.message || "QR scanned successfully.");
        if (source === "camera") {
          await stopCamera();
        }
      } catch (err) {
        setError(err.message || "Failed to scan seller QR");
      } finally {
        setScanBusy(false);
      }
    },
    [scanBusy, stopCamera]
  );

  const startCamera = () => {
    setError("");
    setSuccess("");
    if (!isSecure) {
      setError("Camera access requires a Secure Context (HTTPS or localhost). Please check your connection.");
      return;
    }
    setCameraActive(true);
  };

  useEffect(() => {
    let isMounted = true;
    const initScanner = async () => {
      if (cameraActive) {
        try {
          const container = document.getElementById("reader-container");
          if (container) container.innerHTML = "";

          const scanner = new Html5Qrcode("reader-container");
          scannerRef.current = scanner;

          const config = {
            fps: 15,
            qrbox: (viewWidth, viewHeight) => {
              const minDim = Math.min(viewWidth, viewHeight);
              return { width: Math.floor(minDim * 0.7), height: Math.floor(minDim * 0.7) };
            },
            aspectRatio: 1.0,
            rememberLastUsedCamera: true,
            supportedScanTypes: [0] 
          };

          try {
            await scanner.start(
              { facingMode: { exact: "environment" } }, 
              config, 
              (decodedText) => {
                if (isMounted) submitQr(decodedText, "camera");
              }
            );
          } catch (firstErr) {
            console.warn("Exact environment failed, trying standard environment...", firstErr);
            try {
              await scanner.start({ facingMode: "environment" }, config, (decodedText) => {
                if (isMounted) submitQr(decodedText, "camera");
              });
            } catch (secondErr) {
              console.warn("Back camera failed, trying any camera...", secondErr);
              await scanner.start({ facingMode: "user" }, config, (decodedText) => {
                if (isMounted) submitQr(decodedText, "camera");
              });
            }
          }
        } catch (err) {
          if (isMounted) {
            let msg = err.message || "Failed to start camera scanner.";
            if (msg.includes("Permission")) {
              msg = "Camera permission denied. Please allow camera access in your browser settings.";
            } else if (msg.includes("NotFound")) {
              msg = "No camera found on this device.";
            } else if (msg.includes("Constraint")) {
              msg = "Your device camera does not support the required settings.";
            }
            setError(msg);
            setCameraActive(false);
          }
        }
      }
    };

    initScanner();

    return () => {
      isMounted = false;
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch((e) => console.error("Cleanup stop error", e));
      }
    };
  }, [cameraActive, submitQr, isSecure]);

  useEffect(() => {
    const loadProfile = async () => {
      setLoadingProfile(true);
      try {
        const portal = await dmsService.getPortalProfile();
        setProfile(portal);
      } catch (err) {
        setError(err.message || "Failed to load delivery center profile.");
      } finally {
        setLoadingProfile(false);
      }
    };

    loadProfile();
  }, []);


  const handleManualSubmit = async (event) => {
    event.preventDefault();
    await submitQr(manualQrText, "manual");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-white/5 p-6 rounded-2xl border border-white/10 backdrop-blur-md">
          <div className="flex-1">
            <h1 className="text-3xl font-black tracking-tight">Delivery Center QR Reader</h1>
            <p className="text-slate-400 text-sm mt-1">
              Scan seller QR to register transfer from seller to delivery company.
            </p>
            <div className="mt-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              {loadingProfile
                ? "Loading center profile..."
                : `${profile?.branch?.branchName || "Delivery Center"} • ${profile?.staff?.fullName || "Staff"}`}
            </div>
          </div>
          <div className="flex gap-3 w-full md:w-auto">
            <Link 
              to="/dms/center/dashboard" 
              className="px-6 py-3 rounded-xl font-bold bg-white/5 border border-white/10 hover:bg-white/10 transition-all text-center flex-1 md:flex-none"
            >
              ← Back
            </Link>
            {!cameraActive ? (
              <button 
                className="flex-1 md:flex-none bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 px-8 py-3 rounded-xl font-bold shadow-lg shadow-purple-900/20 active:scale-95 disabled:opacity-50"
                onClick={startCamera} 
                disabled={scanBusy}
              >
                Start Scan
              </button>
            ) : (
              <button 
                className="flex-1 md:flex-none bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 px-8 py-3 rounded-xl font-bold active:scale-95"
                onClick={stopCamera}
              >
                Stop Camera
              </button>
            )}
          </div>
        </div>

        {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4 text-sm font-medium">{error}</div>}
        {success && <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl p-4 text-sm font-medium">{success}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Camera Card */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col items-center">
            <div className="w-full mb-4">
              <h2 className="text-xl font-bold">Camera Scanner</h2>
              <p className="text-slate-500 text-sm">Position seller QR inside the camera view.</p>
            </div>
            
            <div 
              id="reader-container" 
              className="w-full aspect-square max-w-sm rounded-2xl overflow-hidden border-2 border-white/10 bg-black flex items-center justify-center relative shadow-inner"
            >
              {!cameraActive && <div className="text-slate-600 font-bold uppercase tracking-widest text-xs">Camera Idle</div>}
            </div>
            
            {!isSecure && (
              <div className="mt-4 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl p-3 text-xs text-center w-full">
                Camera access restricted. Use HTTPS or localhost.
              </div>
            )}
          </div>

          {/* Manual Input Card */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 h-full flex flex-col">
            <div className="w-full mb-4">
              <h2 className="text-xl font-bold">Manual QR Input</h2>
              <p className="text-slate-500 text-sm">Paste scanned QR text and submit manually.</p>
            </div>
            
            <form onSubmit={handleManualSubmit} className="space-y-4 flex-1 flex flex-col">
              <textarea
                className="w-full flex-1 bg-white/5 border border-white/10 rounded-xl p-4 outline-none focus:ring-2 focus:ring-purple-500/50 text-white placeholder:text-slate-700 min-h-[120px] resize-none"
                placeholder="Example: SOQR4:seller:order..."
                value={manualQrText}
                onChange={(e) => setManualQrText(e.target.value)}
              />
              <button 
                type="submit" 
                disabled={scanBusy}
                className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-purple-900/20 active:scale-95 disabled:opacity-50"
              >
                {scanBusy ? "PROCESSING..." : "SUBMIT QR MANUALLY"}
              </button>
            </form>
          </div>
        </div>

        {/* Scan Results */}
        {lastResult && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <h2 className="text-2xl font-black flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></span>
                Scan Success: Transfer Registered
              </h2>
              <div className="px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-xs font-bold uppercase tracking-widest">
                {lastResult?.deliveryOrder?.status || "RECEIVED"}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Deliver QR Code Column */}
              <div className="bg-white/5 rounded-2xl p-6 border border-white/5 flex flex-col items-center justify-center text-center space-y-4">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Generated Deliver QR</div>
                <div className="p-4 bg-white rounded-2xl shadow-2xl shadow-indigo-500/20">
                  <QRCodeCanvas 
                    value={lastResult?.deliveryOrder?.trackingNumber || "N/A"} 
                    size={160}
                    level="H"
                    includeMargin={false}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-lg font-black tracking-tighter text-indigo-400">
                    {lastResult?.deliveryOrder?.trackingNumber}
                  </div>
                  <div className="text-[9px] font-bold text-slate-500 uppercase">Tracking Number</div>
                </div>
              </div>

              {/* Order & Product Details */}
              <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-6">
                  <DetailSection title="Recipient Details">
                    <DetailItem label="Customer" value={lastResult?.deliveryOrder?.destination?.fullName} />
                    <DetailItem label="Phone" value={lastResult?.deliveryOrder?.destination?.phone} />
                    <DetailItem label="Address" value={lastResult?.deliveryOrder?.destination?.address} />
                    <DetailItem label="City" value={`${lastResult?.deliveryOrder?.destination?.city}, ${lastResult?.deliveryOrder?.destination?.province}`} />
                  </DetailSection>
                </div>

                <div className="space-y-6">
                  <DetailSection title="Product & Logistics">
                    <DetailItem label="Package" value={lastResult?.deliveryOrder?.packageDetails?.packageLabel || "Standard Package"} />
                    <DetailItem label="Items" value={`${lastResult?.deliveryOrder?.packageDetails?.itemCount || 1} Unit(s)`} />
                    <DetailItem label="COD Amount" value={lastResult?.deliveryOrder?.cod?.enabled ? `Rs. ${lastResult?.deliveryOrder?.cod?.amount.toLocaleString()}` : "PREPAID"} highlight={lastResult?.deliveryOrder?.cod?.enabled} />
                    <DetailItem label="Scan Time" value={formatDate(lastResult?.event?.occurredAt)} />
                  </DetailSection>
                </div>
              </div>
            </div>
            
            <div className="pt-4 border-t border-white/5 flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="text-xs text-slate-500 font-medium">
                The Deliver QR above must be scanned by the rider during final delivery.
              </div>
              <button 
                onClick={() => window.print()}
                className="w-full md:w-auto bg-white text-slate-950 px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-slate-200 transition-colors active:scale-95"
              >
                Print Label
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailSection({ title, children }) {
  return (
    <div className="space-y-3">
      <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500/80">{title}</h3>
      <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4 space-y-3">
        {children}
      </div>
    </div>
  );
}

function DetailItem({ label, value, highlight = false }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
      <span className={`text-sm font-bold truncate ${highlight ? "text-amber-400" : "text-slate-200"}`}>
        {value || "Not Provided"}
      </span>
    </div>
  );
}

function formatDate(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}
