import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { dmsService } from "../services/dmsService";
import { QRCodeCanvas } from "qrcode.react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

const RIDER_FORM_INITIAL = {
  fullName: "",
  email: "",
  phone: "",
  employeeId: "",
  password: "",
  confirmPassword: "",
};

function Metric({ label, value, color = "text-purple-400" }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col justify-center items-center text-center">
      <div className={`text-2xl font-black ${color}`}>{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-1">{label}</div>
    </div>
  );
}

export default function DmsCenterDashboard() {
  const navigate = useNavigate();
  const qrRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState(null);
  const [dashboard, setDashboard] = useState({});
  const [shipments, setShipments] = useState([]);
  const [queue, setQueue] = useState([]);
  const [riders, setRiders] = useState([]);
  const [riderForm, setRiderForm] = useState(RIDER_FORM_INITIAL);
  const [riderSubmitting, setRiderSubmitting] = useState(false);
  const [riderError, setRiderError] = useState("");
  const [riderSuccess, setRiderSuccess] = useState("");

  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpBusy, setOtpBusy] = useState(false);
  const [deliverySuccess, setDeliverySuccess] = useState("");
  const [deliveryError, setDeliveryError] = useState("");

  const [selectedShipment, setSelectedShipment] = useState(null);
  const [assigningRiderId, setAssigningRiderId] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState("");
  const [assignSuccess, setAssignSuccess] = useState("");

  const isRider = useMemo(
    () => profile?.staff?.role === "delivery_rider",
    [profile?.staff?.role]
  );
  const canManageRiders = useMemo(
    () => ["branch_manager", "dispatch_operator"].includes(profile?.staff?.role || ""),
    [profile?.staff?.role]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const portal = await dmsService.getPortalProfile();
      setProfile(portal);

      const branchId = portal?.branch?.id || portal?.actor?.branchId;
      if (!branchId) {
        throw new Error("Branch center is not linked to this account");
      }

      const canViewRiders = ["branch_manager", "dispatch_operator"].includes(portal?.staff?.role || "");
      const ridersRequest = canViewRiders
        ? dmsService.getStaff({ assignedBranchId: branchId, role: "delivery_rider" })
        : Promise.resolve({ staff: [] });

      const wrap = (p, name) => p.catch(err => {
        console.error(`Request failed: ${name}`, err);
        throw new Error(`${name} failed: ${err.message}`);
      });

      const [dashboardRes, shipmentsRes, queueRes, ridersRes] = await Promise.all([
        wrap(dmsService.getCenterDashboard(), "Dashboard Summary"),
        wrap(dmsService.getCenterShipments({ view: "active" }), "Active Shipments"),
        wrap(dmsService.getCenterRiderQueue(), "Rider Queue"),
        wrap(ridersRequest, "Rider List"),
      ]);

      setDashboard(dashboardRes?.dashboard || {});
      setShipments(shipmentsRes?.shipments || []);
      setQueue(queueRes?.assignments || []);
      setRiders(ridersRes?.staff || []);
    } catch (err) {
      setError(err.message || "Failed to load center dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleLogout = () => {
    dmsService.clearPortalSession();
    navigate("/dms/login");
  };

  const handleRiderInputChange = (field) => (event) => {
    setRiderForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const handleRiderRegister = async (event) => {
    event.preventDefault();
    setRiderError("");
    setRiderSuccess("");

    const courierCompanyId = profile?.courierCompany?.id || profile?.actor?.courierCompanyId;
    const assignedBranchId = profile?.branch?.id || profile?.actor?.branchId;
    if (!courierCompanyId || !assignedBranchId) {
      setRiderError("Cannot resolve center details for rider registration");
      return;
    }
    if (riderForm.password !== riderForm.confirmPassword) {
      setRiderError("Password confirmation does not match");
      return;
    }

    setRiderSubmitting(true);
    try {
      await dmsService.registerStaff({
        courierCompanyId,
        assignedBranchId,
        role: "delivery_rider",
        fullName: riderForm.fullName,
        email: riderForm.email,
        phone: riderForm.phone,
        employeeId: riderForm.employeeId || undefined,
        password: riderForm.password,
      });
      setRiderSuccess("Rider account registered. Rider can now log in from DMS sign in.");
      setRiderForm(RIDER_FORM_INITIAL);
      await load();
    } catch (err) {
      setRiderError(err.message || "Failed to register rider");
    } finally {
      setRiderSubmitting(false);
    }
  };

  const handleInitiateDelivery = async () => {
    if (!selectedAssignment?.deliveryOrderId?.trackingNumber) return;
    setOtpBusy(true);
    setDeliveryError("");
    try {
      const res = await dmsService.initiateDeliveryConfirmation(selectedAssignment.deliveryOrderId.trackingNumber);
      setOtpSent(true);
      // For demo purposes, we might show the OTP if returned (it is in our dev controller)
      if (res.otp) {
        console.log("DEMO OTP:", res.otp);
        setDeliverySuccess(`OTP sent to customer. [Demo Only: ${res.otp}]`);
      } else {
        setDeliverySuccess("OTP has been sent to the customer's mobile number.");
      }
    } catch (err) {
      setDeliveryError(err.message || "Failed to initiate delivery confirmation");
    } finally {
      setOtpBusy(false);
    }
  };

  const handleVerifyDeliveryOtp = async (event) => {
    event.preventDefault();
    if (!selectedAssignment?.deliveryOrderId?.trackingNumber || !otp) return;
    setOtpBusy(true);
    setDeliveryError("");
    setDeliverySuccess("");
    try {
      await dmsService.verifyDeliveryOtp(selectedAssignment.deliveryOrderId.trackingNumber, otp);
      setDeliverySuccess("Delivery confirmed successfully!");
      setOtp("");
      setOtpSent(false);
      // Refresh dashboard after success
      setTimeout(() => {
        setSelectedAssignment(null);
        load();
      }, 2000);
    } catch (err) {
      setDeliveryError(err.message || "Invalid OTP or verification failed");
    } finally {
      setOtpBusy(false);
    }
  };

  const handleAssignRider = async (event) => {
    event.preventDefault();
    if (!selectedShipment || !assigningRiderId) return;

    setAssignBusy(true);
    setAssignError("");
    setAssignSuccess("");

    try {
      await dmsService.assignShipment({
        deliveryOrderId: selectedShipment._id,
        riderStaffId: assigningRiderId,
      });
      setAssignSuccess("Shipment successfully assigned to rider.");
      setTimeout(() => {
        setSelectedShipment(null);
        setAssigningRiderId("");
        load();
      }, 1500);
    } catch (err) {
      setAssignError(err.message || "Failed to assign shipment.");
    } finally {
      setAssignBusy(false);
    }
  };

  const handleExportAsImage = async (trackingNumber) => {
    if (!qrRef.current) return;
    try {
      const canvas = qrRef.current.querySelector("canvas");
      if (!canvas) return;
      const url = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = url;
      link.download = `QR_${trackingNumber}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Export image failed", err);
    }
  };

  const handleExportAsPDF = async (trackingNumber, orderData) => {
    if (!qrRef.current) return;
    try {
      const canvas = await html2canvas(qrRef.current);
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      
      // Header
      pdf.setFontSize(18);
      pdf.text("Delivery Shipment Label", 20, 20);
      
      // Order Details
      pdf.setFontSize(10);
      pdf.text(`Tracking Number: ${trackingNumber}`, 20, 35);
      pdf.text(`Recipient: ${orderData?.destination?.fullName || "N/A"}`, 20, 42);
      pdf.text(`Address: ${orderData?.destination?.address || "N/A"}`, 20, 49);
      pdf.text(`City: ${orderData?.destination?.city || "N/A"}`, 20, 56);
      
      if (orderData?.cod?.enabled) {
        pdf.text(`COD Amount: Rs. ${orderData.cod.amount.toLocaleString()}`, 20, 65);
      }

      // QR Code
      pdf.addImage(imgData, "PNG", 70, 80, 60, 60);
      
      pdf.save(`Shipment_${trackingNumber}.pdf`);
    } catch (err) {
      console.error("Export PDF failed", err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-white/5 p-6 rounded-2xl border border-white/10 backdrop-blur-md">
          <div>
            <h1 className="text-3xl font-black tracking-tight">Delivery Center Dashboard</h1>
            <p className="text-slate-400 mt-1">
              {profile?.branch?.branchName || "Center"} • {profile?.staff?.fullName || "Staff"}
            </p>
          </div>
          <div className="flex flex-wrap gap-3 w-full md:w-auto">
            <button 
              className="flex-1 md:flex-none bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 px-6 py-3 rounded-xl font-bold transition-all shadow-lg shadow-purple-900/20 active:scale-95 disabled:opacity-50"
              onClick={() => navigate("/dms/center/scan")} 
              disabled={loading}
            >
              Scan Seller QR
            </button>
            <button 
              className="px-6 py-3 rounded-xl font-bold bg-white/5 border border-white/10 hover:bg-white/10 transition-all active:scale-95 disabled:opacity-50"
              onClick={load} 
              disabled={loading}
            >
              Refresh
            </button>
            <button 
              className="px-6 py-3 rounded-xl font-bold bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all active:scale-95"
              onClick={handleLogout}
            >
              Logout
            </button>
          </div>
        </div>

        {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4 text-sm font-medium">{error}</div>}
        {loading && <div className="text-slate-500 text-sm animate-pulse">Loading center analytics...</div>}

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 md:gap-4">
          <Metric label="Handled" value={dashboard?.shipmentsHandled || 0} />
          <Metric label="Delivered" value={dashboard?.delivered || 0} />
          <Metric label="Failed" value={dashboard?.failed || 0} />
          <Metric label="Delayed" value={dashboard?.delayed || 0} />
          <Metric label="Inventory" value={dashboard?.branchInventory || 0} />
          <Metric label="Performance" value={`${dashboard?.onTimePerformance || 0}%`} color="text-emerald-400" />
        </div>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Shipment Queue */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-500"></span>
              Center Shipment Queue
            </h2>
            <div className="space-y-3">
              {shipments.slice(0, 10).map((item) => (
                <div 
                  key={item._id} 
                  className={`bg-white/5 border border-white/5 rounded-xl p-4 transition-all ${canManageRiders ? "hover:bg-white/10 cursor-pointer border-purple-500/0 hover:border-purple-500/30" : ""}`}
                  onClick={() => canManageRiders && setSelectedShipment(item)}
                >
                  <div className="flex justify-between items-start">
                    <div className="font-bold">{item.trackingNumber}</div>
                    <div className="text-[10px] px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded font-bold uppercase">
                      {item.status}
                    </div>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-2 uppercase tracking-wider font-bold">
                    {item.destination?.city || "Destination Unknown"} • {item.packageDetails?.packageLabel || "Standard Item"}
                  </div>
                  {canManageRiders && !item.currentRiderId && (
                    <div className="mt-3 text-[9px] font-black text-purple-400 uppercase tracking-widest flex items-center gap-1">
                      Click to assign rider <span className="text-lg">→</span>
                    </div>
                  )}
                </div>
              ))}
              {shipments.length === 0 && <div className="text-slate-600 text-sm py-8 text-center italic">No active center shipments</div>}
            </div>
          </div>

          {/* Rider Queue */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
              {isRider ? "My Rider Queue" : "Rider Assignment Queue"}
            </h2>
            <div className="space-y-3">
              {queue.slice(0, 10).map((item) => (
                <div 
                  key={item._id} 
                  className={`bg-white/5 border border-white/5 rounded-xl p-4 transition-all ${isRider ? "hover:bg-white/10 cursor-pointer border-indigo-500/0 hover:border-indigo-500/30" : ""}`}
                  onClick={() => isRider && setSelectedAssignment(item)}
                >
                  <div className="flex justify-between items-start">
                    <div className="font-bold">{item.deliveryOrderId?.trackingNumber || item.deliveryOrderId}</div>
                    <div className="text-[10px] px-2 py-0.5 bg-indigo-500/20 text-indigo-400 rounded font-bold uppercase">
                      {item.status}
                    </div>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-2 uppercase tracking-wider font-bold">
                    Position #{item.queuePosition || 0} • {item.deliveryOrderId?.destination?.city || "Unknown City"}
                  </div>
                  {isRider && (
                    <div className="mt-3 text-[9px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-1">
                      Click to deliver <span className="text-lg">→</span>
                    </div>
                  )}
                </div>
              ))}
              {queue.length === 0 && <div className="text-slate-600 text-sm py-8 text-center italic">No active rider assignments</div>}
            </div>
          </div>
        </div>

        {/* Delivery Modal for Riders */}
        {selectedAssignment && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-in fade-in duration-300 overflow-y-auto">
            <div className="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 max-h-full flex flex-col my-auto">
              <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/5">
                <h3 className="text-xl font-black">Confirm Final Delivery</h3>
                <button 
                  onClick={() => {
                    setSelectedAssignment(null);
                    setOtpSent(false);
                    setOtp("");
                    setDeliveryError("");
                    setDeliverySuccess("");
                  }}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-slate-400"
                >
                  ✕
                </button>
              </div>

              <div className="p-6 space-y-6 overflow-y-auto min-h-0">
                {/* Details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                  <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                    <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Customer</div>
                    <div className="text-sm font-bold text-white">{selectedAssignment.deliveryOrderId?.destination?.fullName}</div>
                  </div>
                  <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                    <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Tracking #</div>
                    <div className="text-sm font-bold text-indigo-400 break-all">{selectedAssignment.deliveryOrderId?.trackingNumber}</div>
                  </div>
                </div>

                <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                  <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Delivery Address</div>
                  <div className="text-sm font-medium text-slate-300 leading-relaxed">
                    {selectedAssignment.deliveryOrderId?.destination?.address}<br/>
                    {selectedAssignment.deliveryOrderId?.destination?.city}, {selectedAssignment.deliveryOrderId?.destination?.province}
                  </div>
                </div>

                {/* Delivery QR Section */}
                <div className="bg-white/5 rounded-3xl p-6 border border-white/5 flex flex-col items-center gap-4">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Final Delivery QR</div>
                  <div ref={qrRef} className="bg-white p-4 rounded-2xl shadow-xl">
                    <QRCodeCanvas 
                      value={selectedAssignment.deliveryOrderId?.trackingNumber || "N/A"}
                      size={window.innerWidth < 640 ? 140 : 180}
                      level="H"
                      includeMargin={true}
                    />
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 w-full">
                    <button 
                      onClick={() => handleExportAsImage(selectedAssignment.deliveryOrderId?.trackingNumber)}
                      className="flex-1 bg-white/5 hover:bg-white/10 text-slate-300 py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
                    >
                      <span>🖼️</span> Export PNG
                    </button>
                    <button 
                      onClick={() => handleExportAsPDF(selectedAssignment.deliveryOrderId?.trackingNumber, selectedAssignment.deliveryOrderId)}
                      className="flex-1 bg-white/5 hover:bg-white/10 text-slate-300 py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
                    >
                      <span>📄</span> Export PDF
                    </button>
                  </div>
                </div>

                {selectedAssignment.deliveryOrderId?.cod?.enabled && (
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex justify-between items-center">
                    <div>
                      <div className="text-[9px] font-bold text-amber-500/80 uppercase tracking-widest">Collect Payment (COD)</div>
                      <div className="text-xl font-black text-amber-400">Rs. {selectedAssignment.deliveryOrderId.cod.amount.toLocaleString()}</div>
                    </div>
                    <div className="w-10 h-10 bg-amber-500/20 rounded-full flex items-center justify-center text-amber-400">
                      $
                    </div>
                  </div>
                )}

                {/* Status Messages */}
                {deliveryError && (
                  <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4 text-xs font-bold">
                    {deliveryError}
                  </div>
                )}
                {deliverySuccess && (
                  <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl p-4 text-xs font-bold">
                    {deliverySuccess}
                  </div>
                )}

                {/* OTP Flow */}
                {!otpSent ? (
                  <button 
                    onClick={handleInitiateDelivery}
                    disabled={otpBusy}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-indigo-900/40 transition-all active:scale-95 disabled:opacity-50"
                  >
                    {otpBusy ? "GENERATING OTP..." : "INITIATE OTP VERIFICATION"}
                  </button>
                ) : (
                  <form onSubmit={handleVerifyDeliveryOtp} className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Enter Customer OTP</label>
                      <input 
                        type="text"
                        maxLength="6"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value)}
                        placeholder="000000"
                        className="w-full bg-white/10 border border-white/20 rounded-2xl px-6 py-4 text-2xl text-center font-black tracking-[0.5em] focus:ring-4 focus:ring-indigo-500/20 outline-none"
                        required
                      />
                    </div>
                    <div className="flex gap-3">
                      <button 
                        type="button"
                        onClick={() => setOtpSent(false)}
                        className="flex-1 bg-white/5 hover:bg-white/10 text-slate-400 font-bold py-4 rounded-2xl transition-all"
                      >
                        Resend
                      </button>
                      <button 
                        type="submit"
                        disabled={otpBusy || otp.length < 6}
                        className="flex-[2] bg-emerald-600 hover:bg-emerald-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-emerald-900/40 transition-all active:scale-95 disabled:opacity-50"
                      >
                        {otpBusy ? "VERIFYING..." : "CONFIRM DELIVERY"}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Shipment Assignment Modal for Managers */}
        {selectedShipment && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-in fade-in duration-300 overflow-y-auto">
            <div className="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 max-h-full flex flex-col my-auto">
              <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/5">
                <h3 className="text-xl font-black">Shipment Details</h3>
                <button 
                  onClick={() => {
                    setSelectedShipment(null);
                    setAssignError("");
                    setAssignSuccess("");
                    setAssigningRiderId("");
                  }}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-slate-400"
                >
                  ✕
                </button>
              </div>

              <div className="p-6 space-y-6 overflow-y-auto min-h-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                  <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                    <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Tracking #</div>
                    <div className="text-sm font-bold text-purple-400 break-all">{selectedShipment.trackingNumber}</div>
                  </div>
                  <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                    <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Status</div>
                    <div className="text-sm font-bold text-white uppercase break-words">{selectedShipment.status}</div>
                  </div>
                </div>

                <div className="bg-white/5 rounded-2xl p-4 border border-white/5 space-y-3">
                  <div>
                    <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Recipient & Destination</div>
                    <div className="text-sm font-bold text-white">{selectedShipment.destination?.fullName}</div>
                    <div className="text-xs text-slate-400 mt-1">{selectedShipment.destination?.address}, {selectedShipment.destination?.city}</div>
                  </div>
                </div>

                {/* Delivery QR Section */}
                <div className="bg-white/5 rounded-3xl p-6 border border-white/5 flex flex-col items-center gap-4">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Shipment Tracking QR</div>
                  <div ref={qrRef} className="bg-white p-4 rounded-2xl shadow-xl">
                    <QRCodeCanvas 
                      value={selectedShipment.trackingNumber}
                      size={window.innerWidth < 640 ? 130 : 160}
                      level="H"
                      includeMargin={true}
                    />
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 w-full">
                    <button 
                      onClick={() => handleExportAsImage(selectedShipment.trackingNumber)}
                      className="flex-1 bg-white/5 hover:bg-white/10 text-slate-300 py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
                    >
                      <span>🖼️</span> Save Image
                    </button>
                    <button 
                      onClick={() => handleExportAsPDF(selectedShipment.trackingNumber, selectedShipment)}
                      className="flex-1 bg-white/5 hover:bg-white/10 text-slate-300 py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
                    >
                      <span>📄</span> Save PDF
                    </button>
                  </div>
                </div>

                {selectedShipment.cod?.enabled && (
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex justify-between items-center">
                    <div>
                      <div className="text-[9px] font-bold text-amber-500/80 uppercase tracking-widest">COD Payment</div>
                      <div className="text-xl font-black text-amber-400">Rs. {selectedShipment.cod.amount.toLocaleString()}</div>
                    </div>
                  </div>
                )}

                {assignError && <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4 text-xs font-bold">{assignError}</div>}
                {assignSuccess && <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl p-4 text-xs font-bold">{assignSuccess}</div>}

                <form onSubmit={handleAssignRider} className="space-y-4 pt-4 border-t border-white/5">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Assign to Rider</label>
                    <select 
                      className="w-full bg-white/10 border border-white/20 rounded-2xl px-6 py-4 text-white font-bold outline-none focus:ring-4 focus:ring-purple-500/20"
                      value={assigningRiderId}
                      onChange={(e) => setAssigningRiderId(e.target.value)}
                      required
                    >
                      <option value="" className="bg-slate-900">Select a rider...</option>
                      {riders.map(rider => (
                        <option key={rider._id} value={rider._id} className="bg-slate-900">
                          {rider.fullName} ({rider.employeeId || "No ID"})
                        </option>
                      ))}
                    </select>
                  </div>
                  <button 
                    type="submit" 
                    disabled={assignBusy || !assigningRiderId}
                    className="w-full bg-purple-600 hover:bg-purple-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-purple-900/40 transition-all active:scale-95 disabled:opacity-50"
                  >
                    {assignBusy ? "ASSIGNING..." : "CONFIRM ASSIGNMENT"}
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Rider Management */}
        {canManageRiders && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold">Register Rider Accounts</h2>
              <p className="text-slate-400 text-sm mt-1">Add new riders to this center. They can then sign in via the portal.</p>
            </div>

            {riderError && <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4 text-sm mb-4">{riderError}</div>}
            {riderSuccess && <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl p-4 text-sm mb-4">{riderSuccess}</div>}

            <form className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" onSubmit={handleRiderRegister}>
              <input className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-purple-500/50" placeholder="Full Name" value={riderForm.fullName} onChange={handleRiderInputChange("fullName")} required />
              <input className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-purple-500/50" placeholder="Email Address" type="email" value={riderForm.email} onChange={handleRiderInputChange("email")} required />
              <input className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-purple-500/50" placeholder="Phone Number" value={riderForm.phone} onChange={handleRiderInputChange("phone")} />
              <input className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-purple-500/50" placeholder="Employee ID" value={riderForm.employeeId} onChange={handleRiderInputChange("employeeId")} />
              <input className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-purple-500/50" placeholder="Password" type="password" value={riderForm.password} onChange={handleRiderInputChange("password")} required />
              <input className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-purple-500/50" placeholder="Confirm Password" type="password" value={riderForm.confirmPassword} onChange={handleRiderInputChange("confirmPassword")} required />
              <button className="md:col-span-2 lg:col-span-1 bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 rounded-xl transition-all" type="submit" disabled={riderSubmitting}>
                {riderSubmitting ? "Registering..." : "Register Rider"}
              </button>
            </form>

            <div className="mt-10">
              <h3 className="text-lg font-bold mb-4 text-slate-300">Registered Center Riders</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {riders.map((rider) => (
                  <div key={rider._id} className="bg-white/5 border border-white/5 rounded-xl p-4">
                    <div className="font-bold">{rider.fullName}</div>
                    <div className="text-xs text-slate-500 mt-1 uppercase tracking-tight truncate">
                      {rider.employeeId || "No ID"} • {rider.email}
                    </div>
                    <div className="mt-2 inline-block px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded text-[10px] font-bold uppercase">
                      {rider.status}
                    </div>
                  </div>
                ))}
                {riders.length === 0 && <div className="text-slate-600 text-sm py-4 italic">No riders registered yet</div>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

