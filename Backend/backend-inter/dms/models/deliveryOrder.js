import mongoose from "mongoose";
import { SHIPMENT_STATUS } from "../constants/dmsEnums.js";

const deliveryAddressSchema = new mongoose.Schema(
  {
    fullName: { type: String, default: "" },
    phone: { type: String, default: "" },
    province: { type: String, default: "" },
    district: { type: String, default: "" },
    city: { type: String, default: "" },
    address: { type: String, default: "" },
    postalCode: { type: String, default: "" },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
  },
  { _id: false }
);

const packageSchema = new mongoose.Schema(
  {
    weightKg: { type: Number, default: 0 },
    heightCm: { type: Number, default: 0 },
    widthCm: { type: Number, default: 0 },
    lengthCm: { type: Number, default: 0 },
    itemCount: { type: Number, default: 1 },
    packageLabel: { type: String, default: "" },
  },
  { _id: false }
);

const deliveryOrderSchema = new mongoose.Schema(
  {
    trackingNumber: { type: String, required: true, unique: true, trim: true, index: true },
    ecommerceOrderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null, index: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    courierCompanyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CourierCompany",
      required: true,
      index: true,
    },
    assignedBranchId: { type: mongoose.Schema.Types.ObjectId, ref: "CourierBranch", default: null, index: true },
    currentBranchId: { type: mongoose.Schema.Types.ObjectId, ref: "CourierBranch", default: null, index: true },
    currentRiderId: { type: mongoose.Schema.Types.ObjectId, ref: "CourierStaff", default: null, index: true },
    destination: { type: deliveryAddressSchema, required: true },
    packageDetails: { type: packageSchema, default: () => ({}) },
    status: {
      type: String,
      enum: SHIPMENT_STATUS,
      default: "shipment_registered",
      index: true,
    },
    statusTimeline: {
      shipmentRegisteredAt: { type: Date, default: Date.now },
      receivedAtBranchAt: { type: Date, default: null },
      sortingStartedAt: { type: Date, default: null },
      outForDeliveryAt: { type: Date, default: null },
      deliveredAt: { type: Date, default: null },
      failedAt: { type: Date, default: null },
      returnedAt: { type: Date, default: null },
    },
    attempts: {
      deliveryAttempts: { type: Number, default: 0 },
      maxAttempts: { type: Number, default: 3 },
      failedReason: { type: String, default: "" },
    },
    cod: {
      enabled: { type: Boolean, default: false },
      amount: { type: Number, default: 0 },
      collected: { type: Boolean, default: false },
      collectedAt: { type: Date, default: null },
      collectedByRiderId: { type: mongoose.Schema.Types.ObjectId, ref: "CourierStaff", default: null },
      requiresExtraVerification: { type: Boolean, default: false },
    },
    routing: {
      assignedByRuleId: { type: mongoose.Schema.Types.ObjectId, ref: "DeliveryRule", default: null },
      serviceZoneId: { type: mongoose.Schema.Types.ObjectId, ref: "ServiceZone", default: null },
      routePlan: { type: String, default: "" },
      assignmentReason: { type: String, default: "" },
    },
    scanSummary: {
      lastScanType: { type: String, default: "" },
      lastScanAt: { type: Date, default: null },
      missingRequiredScans: { type: Boolean, default: false },
      duplicateScanCount: { type: Number, default: 0 },
    },
    risk: {
      flags: { type: [String], default: [] },
      anomalyScore: { type: Number, default: 0 },
      blockedForInvestigation: { type: Boolean, default: false },
    },
    expectedDeliveryAt: { type: Date, default: null, index: true },
    deliveryFee: { type: Number, default: 0 },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    verification: {
      otp: { type: String, default: null },
      otpExpiresAt: { type: Date, default: null },
      isVerified: { type: Boolean, default: false },
      verifiedAt: { type: Date, default: null },
    },
    updatedByStaffId: { type: mongoose.Schema.Types.ObjectId, ref: "CourierStaff", default: null },
  },
  { timestamps: true }
);

deliveryOrderSchema.index({ courierCompanyId: 1, status: 1, assignedBranchId: 1 });
deliveryOrderSchema.index({ sellerId: 1, createdAt: -1 });

const DeliveryOrder = mongoose.model("DeliveryOrder", deliveryOrderSchema);
export default DeliveryOrder;

