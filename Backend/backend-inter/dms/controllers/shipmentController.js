import DeliveryOrder from "../models/deliveryOrder.js";
import DeliveryAssignment from "../models/deliveryAssignment.js";
import ShipmentTrackingEvent from "../models/shipmentTrackingEvent.js";
import DeliveryDispute from "../models/deliveryDispute.js";
import CourierCompany from "../models/courierCompany.js";
import CourierBranch from "../models/courierBranch.js";
import CourierStaff from "../models/courierStaff.js";
import DeliveryRule from "../models/deliveryRule.js";
import ServiceZone from "../models/serviceZone.js";
import Order from "../../models/order.js";
import { withTenantScope } from "../middleware/dmsAccess.js";
import { generateTrackingNumber } from "../utils/idGenerator.js";
import { requireFields } from "../utils/validation.js";
import { assignBranchByRules, findServiceZone } from "../services/routingEngine.js";
import { detectScanAnomalies } from "../services/fraudService.js";
import { createAuditLog } from "../services/auditService.js";
import { emitDeliveryNotification } from "../services/notificationService.js";
import { parseSellerQrOrderId } from "../../services/sellerQrPayloadService.js";

function actorForAudit(req) {
  return {
    actorType: req.dmsActor?.actorType || "system",
    userId: req.dmsActor?.userId || null,
    staffId: req.dmsActor?.staffId || null,
    role: req.dmsActor?.actorRole || "",
  };
}

function scanTypeToStatus(scanType) {
  const statusMap = {
    branch_received: "received_at_branch",
    warehouse_sorted: "in_sorting",
    out_for_delivery: "out_for_delivery",
    delivered: "delivered",
    failed_delivery: "failed_delivery",
    returned: "returned",
  };
  return statusMap[scanType] || null;
}

async function evaluateCodVerificationRequirement({ courierCompanyId, destination, codAmount }) {
  if (!codAmount || codAmount <= 0) return false;

  const codRules = await DeliveryRule.find({
    scope: "cod_verification",
    isActive: true,
    $or: [{ courierCompanyId }, { courierCompanyId: null }],
  })
    .sort({ priority: 1 })
    .lean();

  return codRules.some((rule) => {
    const conditions = rule.conditions || {};
    if (conditions.province && conditions.province !== destination.province) return false;
    if (conditions.district && conditions.district !== destination.district) return false;
    if (conditions.minCodAmount !== null && conditions.minCodAmount !== undefined && codAmount < conditions.minCodAmount) return false;
    return true;
  });
}

function applyStatusTimeline(deliveryOrder, nextStatus) {
  const now = new Date();
  if (nextStatus === "received_at_branch") deliveryOrder.statusTimeline.receivedAtBranchAt = now;
  if (nextStatus === "in_sorting") deliveryOrder.statusTimeline.sortingStartedAt = now;
  if (nextStatus === "out_for_delivery") deliveryOrder.statusTimeline.outForDeliveryAt = now;
  if (nextStatus === "delivered") deliveryOrder.statusTimeline.deliveredAt = now;
  if (nextStatus === "failed_delivery") deliveryOrder.statusTimeline.failedAt = now;
  if (nextStatus === "returned") deliveryOrder.statusTimeline.returnedAt = now;
}

function resolveCourierContextForCenterScan(req) {
  const actorScope = req.dmsActor?.scope || "none";
  const actorCourierCompanyId = req.dmsActor?.courierCompanyId || null;
  const actorBranchId = req.dmsActor?.branchId || null;
  const requestedCourierCompanyId = req.body.courierCompanyId ? `${req.body.courierCompanyId}` : null;
  const requestedBranchId = req.body.branchId ? `${req.body.branchId}` : null;

  if (actorScope === "branch" || actorScope === "rider") {
    if (requestedCourierCompanyId && requestedCourierCompanyId !== actorCourierCompanyId) {
      return {
        ok: false,
        status: 403,
        message: "You cannot scan shipments for another courier company.",
      };
    }
    if (requestedBranchId && requestedBranchId !== actorBranchId) {
      return {
        ok: false,
        status: 403,
        message: "You cannot scan shipments for another branch.",
      };
    }
    return {
      ok: true,
      courierCompanyId: actorCourierCompanyId,
      branchId: actorBranchId,
    };
  }

  if (actorScope === "company") {
    if (requestedCourierCompanyId && requestedCourierCompanyId !== actorCourierCompanyId) {
      return {
        ok: false,
        status: 403,
        message: "You cannot scan shipments for another courier company.",
      };
    }
    if (!requestedBranchId) {
      return {
        ok: false,
        status: 400,
        message: "branchId is required for company-level scan operations.",
      };
    }
    return {
      ok: true,
      courierCompanyId: actorCourierCompanyId,
      branchId: requestedBranchId,
    };
  }

  if (actorScope === "platform") {
    if (!requestedCourierCompanyId || !requestedBranchId) {
      return {
        ok: false,
        status: 400,
        message: "courierCompanyId and branchId are required for platform scan operations.",
      };
    }
    return {
      ok: true,
      courierCompanyId: requestedCourierCompanyId,
      branchId: requestedBranchId,
    };
  }

  return {
    ok: false,
    status: 403,
    message: "Access denied for center scan operation.",
  };
}

function buildDestinationFromOrder(ecommerceOrder) {
  const shipping = ecommerceOrder?.shippingAddress || {};
  const hasLat = Number.isFinite(Number(shipping.lat));
  const hasLng = Number.isFinite(Number(shipping.lng));
  const fallbackAddress = [
    shipping.street,
    shipping.city,
    shipping.state,
    shipping.postalCode,
    shipping.country,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    fullName: shipping.fullName || "",
    phone: shipping.phone || "",
    province: shipping.state || "",
    district: shipping.district || "",
    city: shipping.city || "",
    address: shipping.formattedAddress || fallbackAddress || "",
    postalCode: shipping.postalCode || "",
    lat: hasLat ? Number(shipping.lat) : null,
    lng: hasLng ? Number(shipping.lng) : null,
  };
}

function buildPackageDetailsFromOrder(ecommerceOrder) {
  const itemCount = Array.isArray(ecommerceOrder?.items)
    ? ecommerceOrder.items.reduce((sum, item) => sum + Number(item?.quantity || 0), 0)
    : 0;
  return {
    itemCount: itemCount > 0 ? itemCount : 1,
    packageLabel: ecommerceOrder?.sellerQr?.packingProductName || "",
  };
}

async function recordShipmentScan({ req, order, scanPayload }) {
  const fraudCheck = await detectScanAnomalies({
    deliveryOrderId: order._id,
    scanType: scanPayload.scanType,
    scannedByStaffId: req.dmsActor?.staffId || null,
  });

  const nextStatus = scanTypeToStatus(scanPayload.scanType);
  if (nextStatus) {
    order.status = nextStatus;
    applyStatusTimeline(order, nextStatus);
  }

  if (scanPayload.branchId) {
    order.currentBranchId = scanPayload.branchId;
  }
  if (scanPayload.riderStaffId) {
    order.currentRiderId = scanPayload.riderStaffId;
  }

  order.scanSummary.lastScanType = scanPayload.scanType;
  order.scanSummary.lastScanAt = new Date();
  if (fraudCheck.anomalies.includes("duplicate_scan_detected")) {
    order.scanSummary.duplicateScanCount += 1;
  }
  if (fraudCheck.anomalies.includes("missing_scan_sequence")) {
    order.scanSummary.missingRequiredScans = true;
  }
  if (fraudCheck.suspicious) {
    order.risk.flags = Array.from(new Set([...(order.risk.flags || []), ...fraudCheck.anomalies]));
    order.risk.anomalyScore += fraudCheck.anomalyScore;
  }

  await order.save();

  const event = await ShipmentTrackingEvent.create({
    deliveryOrderId: order._id,
    trackingNumber: order.trackingNumber,
    courierCompanyId: order.courierCompanyId,
    branchId: scanPayload.branchId || order.currentBranchId || null,
    riderStaffId: scanPayload.riderStaffId || order.currentRiderId || null,
    scannedByStaffId: req.dmsActor?.staffId || null,
    scannedByUserId: req.user.id,
    scanType: scanPayload.scanType,
    scanMethod: scanPayload.scanMethod || "barcode",
    statusAfterScan: order.status,
    notes: scanPayload.notes || "",
    geolocation: scanPayload.geolocation || {},
    anomalyFlags: fraudCheck.anomalies,
    suspicious: fraudCheck.suspicious,
    occurredAt: scanPayload.occurredAt || new Date(),
    metadata: scanPayload.metadata || {},
  });

  if (order.status === "failed_delivery") {
    order.attempts.deliveryAttempts += 1;
    order.attempts.failedReason = scanPayload.notes || "Delivery failed";
    await order.save();
  }

  if (order.status === "delivered" || order.status === "returned") {
    await DeliveryAssignment.updateMany(
      { deliveryOrderId: order._id, status: "active" },
      { $set: { status: "completed", completedAt: new Date() } }
    );
  }

  if (fraudCheck.suspicious) {
    await createAuditLog({
      category: "dms_fraud",
      action: "shipment.scan_anomaly_detected",
      severity: "warn",
      actor: actorForAudit(req),
      context: {
        courierCompanyId: order.courierCompanyId,
        branchId: event.branchId,
        deliveryOrderId: order._id,
        trackingNumber: order.trackingNumber,
      },
      metadata: { anomalies: fraudCheck.anomalies },
      req,
    });
  }

  await emitDeliveryNotification({
    type: scanPayload.scanType,
    recipients: [order.customerId, order.sellerId].filter(Boolean),
    payload: {
      trackingNumber: order.trackingNumber,
      status: order.status,
      scanType: scanPayload.scanType,
    },
    actor: actorForAudit(req),
    context: { courierCompanyId: order.courierCompanyId, deliveryOrderId: order._id, trackingNumber: order.trackingNumber },
    req,
  });

  return { order, event, fraudCheck };
}

export async function createShipment(req, res) {
  try {
    const missing = requireFields(req.body, ["sellerId", "courierCompanyId", "destination"]);
    if (missing.length) {
      return res.status(400).json({ message: `Missing fields: ${missing.join(", ")}` });
    }

    if (req.dmsActor.scope === "seller" && req.dmsActor.sellerId !== req.body.sellerId) {
      return res.status(403).json({ message: "Sellers can only create their own shipments" });
    }

    const courierCompany = await CourierCompany.findOne({
      _id: req.body.courierCompanyId,
      status: "approved",
    }).lean();
    if (!courierCompany) {
      return res.status(400).json({ message: "Courier company is not approved or does not exist" });
    }

    const destination = req.body.destination || {};
    const codAmount = Number(req.body.cod?.amount || 0);
    const routingDecision = await assignBranchByRules({
      courierCompanyId: req.body.courierCompanyId,
      destination,
      codAmount,
    });
    if (!routingDecision.branch) {
      return res.status(400).json({ message: "No eligible branch found for destination" });
    }

    const zone = await findServiceZone({
      courierCompanyId: req.body.courierCompanyId,
      destination,
    });

    const requiresCodVerification = await evaluateCodVerificationRequirement({
      courierCompanyId: req.body.courierCompanyId,
      destination,
      codAmount,
    });

    const shipment = await DeliveryOrder.create({
      trackingNumber: req.body.trackingNumber || generateTrackingNumber(),
      ecommerceOrderId: req.body.ecommerceOrderId || null,
      sellerId: req.body.sellerId,
      customerId: req.body.customerId || null,
      courierCompanyId: req.body.courierCompanyId,
      assignedBranchId: routingDecision.branch._id,
      currentBranchId: routingDecision.branch._id,
      destination: req.body.destination,
      packageDetails: req.body.packageDetails || {},
      expectedDeliveryAt: req.body.expectedDeliveryAt || null,
      deliveryFee: Number(req.body.deliveryFee || 0),
      cod: {
        enabled: Boolean(req.body.cod?.enabled),
        amount: codAmount,
        requiresExtraVerification:
          Boolean(req.body.cod?.requiresExtraVerification) ||
          Boolean(routingDecision.requireExtraVerification) ||
          requiresCodVerification,
      },
      routing: {
        assignedByRuleId: routingDecision.assignedByRuleId,
        serviceZoneId: zone?._id || null,
        assignmentReason: routingDecision.assignmentReason,
        routePlan: req.body.routePlan || "",
      },
      createdByUserId: req.user.id,
    });

    await createAuditLog({
      category: "dms_workflow",
      action: "shipment.registered",
      actor: actorForAudit(req),
      context: {
        courierCompanyId: shipment.courierCompanyId,
        branchId: shipment.assignedBranchId,
        deliveryOrderId: shipment._id,
        trackingNumber: shipment.trackingNumber,
        targetType: "delivery_order",
        targetId: `${shipment._id}`,
      },
      metadata: {
        assignmentReason: routingDecision.assignmentReason,
        serviceZoneId: zone?._id || null,
      },
      req,
    });

    await emitDeliveryNotification({
      type: "shipment_registered",
      recipients: [shipment.customerId, shipment.sellerId].filter(Boolean),
      payload: { trackingNumber: shipment.trackingNumber, status: shipment.status },
      actor: actorForAudit(req),
      context: { courierCompanyId: shipment.courierCompanyId, deliveryOrderId: shipment._id, trackingNumber: shipment.trackingNumber },
      req,
    });

    return res.status(201).json({ message: "Shipment created", shipment });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create shipment", error: error.message });
  }
}

export async function assignShipment(req, res) {
  try {
    const missing = requireFields(req.body, ["deliveryOrderId", "riderStaffId"]);
    if (missing.length) {
      return res.status(400).json({ message: `Missing fields: ${missing.join(", ")}` });
    }

    const order = await DeliveryOrder.findOne(withTenantScope(req, { _id: req.body.deliveryOrderId }));
    if (!order) {
      return res.status(404).json({ message: "Shipment not found in your scope" });
    }

    const rider = await CourierStaff.findOne({
      _id: req.body.riderStaffId,
      courierCompanyId: order.courierCompanyId,
      role: "delivery_rider",
      status: "active",
    }).lean();
    if (!rider) {
      return res.status(400).json({ message: "Rider is not active or not part of this courier" });
    }

    if (req.dmsActor.scope === "branch" && req.dmsActor.branchId && `${rider.assignedBranchId}` !== req.dmsActor.branchId) {
      return res.status(403).json({ message: "Branch users can only assign riders from their own branch" });
    }

    const activeCount = await DeliveryAssignment.countDocuments({
      riderStaffId: rider._id,
      status: "active",
    });

    await DeliveryAssignment.updateMany(
      { deliveryOrderId: order._id, status: "active" },
      { $set: { status: "cancelled", cancelledAt: new Date() } }
    );

    const assignment = await DeliveryAssignment.create({
      deliveryOrderId: order._id,
      courierCompanyId: order.courierCompanyId,
      branchId: rider.assignedBranchId || order.assignedBranchId,
      riderStaffId: rider._id,
      assignedByStaffId: req.dmsActor?.staffId || null,
      assignedByUserId: req.user.id,
      assignmentType: order.currentRiderId ? "reassign" : "assign",
      reason: req.body.reason || "",
      queuePosition: activeCount + 1,
      status: "active",
    });

    order.currentRiderId = rider._id;
    order.status = "out_for_delivery";
    applyStatusTimeline(order, "out_for_delivery");
    order.updatedByStaffId = req.dmsActor?.staffId || null;
    await order.save();

    await createAuditLog({
      category: "dms_workflow",
      action: "shipment.rider_assigned",
      actor: actorForAudit(req),
      context: {
        courierCompanyId: order.courierCompanyId,
        branchId: assignment.branchId,
        deliveryOrderId: order._id,
        trackingNumber: order.trackingNumber,
      },
      metadata: { riderStaffId: rider._id, queuePosition: assignment.queuePosition },
      req,
    });

    await emitDeliveryNotification({
      type: "rider_assigned",
      recipients: [order.customerId, order.sellerId, rider.authUserId].filter(Boolean),
      payload: { trackingNumber: order.trackingNumber, riderStaffId: rider._id },
      actor: actorForAudit(req),
      context: { courierCompanyId: order.courierCompanyId, deliveryOrderId: order._id, trackingNumber: order.trackingNumber },
      req,
    });

    return res.json({ message: "Rider assigned", assignment, order });
  } catch (error) {
    return res.status(500).json({ message: "Failed to assign rider", error: error.message });
  }
}

export async function scanShipment(req, res) {
  try {
    const missing = requireFields(req.body, ["deliveryOrderId", "scanType"]);
    if (missing.length) {
      return res.status(400).json({ message: `Missing fields: ${missing.join(", ")}` });
    }

    const order = await DeliveryOrder.findOne(withTenantScope(req, { _id: req.body.deliveryOrderId }));
    if (!order) {
      return res.status(404).json({ message: "Shipment not found in your scope" });
    }

    const { order: updatedOrder, event, fraudCheck } = await recordShipmentScan({
      req,
      order,
      scanPayload: req.body,
    });

    return res.json({
      message: "Scan recorded",
      order: updatedOrder,
      event,
      fraud: fraudCheck,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to record scan", error: error.message });
  }
}

export async function scanSellerQrAtCenter(req, res) {
  try {
    const missing = requireFields(req.body, ["qrText"]);
    if (missing.length) {
      return res.status(400).json({ message: `Missing fields: ${missing.join(", ")}` });
    }

    const ecommerceOrderId = parseSellerQrOrderId(req.body.qrText);
    if (!ecommerceOrderId) {
      return res.status(400).json({ message: "Invalid seller QR content. Could not resolve order ID." });
    }

    const ecommerceOrder = await Order.findById(ecommerceOrderId);
    if (!ecommerceOrder) {
      return res.status(404).json({ message: "Seller order not found for scanned QR." });
    }
    if (ecommerceOrder.status === "cancelled") {
      return res.status(400).json({ message: "Cannot transfer a cancelled order to delivery company." });
    }
    if (ecommerceOrder.sellerQr?.verificationStatus !== "approved") {
      return res.status(400).json({ message: "Seller QR is not approved for delivery transfer yet." });
    }

    const context = resolveCourierContextForCenterScan(req);
    if (!context.ok) {
      return res.status(context.status).json({ message: context.message });
    }

    const [courierCompany, branch] = await Promise.all([
      CourierCompany.findOne({
        _id: context.courierCompanyId,
        status: "approved",
      }).lean(),
      CourierBranch.findOne({
        _id: context.branchId,
        courierCompanyId: context.courierCompanyId,
        status: "approved",
      }).lean(),
    ]);

    if (!courierCompany) {
      return res.status(400).json({ message: "Courier company is not approved or not found." });
    }
    if (!branch) {
      return res.status(400).json({ message: "Delivery center branch is not approved or not found." });
    }

    let deliveryOrder = await DeliveryOrder.findOne({
      ecommerceOrderId: ecommerceOrder._id,
    });

    if (deliveryOrder && `${deliveryOrder.courierCompanyId}` !== `${context.courierCompanyId}`) {
      return res.status(409).json({
        message: "This seller order is already linked to another delivery company.",
        trackingNumber: deliveryOrder.trackingNumber,
      });
    }

    if (!deliveryOrder) {
      deliveryOrder = await DeliveryOrder.create({
        trackingNumber: generateTrackingNumber(),
        ecommerceOrderId: ecommerceOrder._id,
        sellerId: ecommerceOrder.sellerId,
        customerId: ecommerceOrder.userId,
        courierCompanyId: context.courierCompanyId,
        assignedBranchId: context.branchId,
        currentBranchId: context.branchId,
        destination: buildDestinationFromOrder(ecommerceOrder),
        packageDetails: buildPackageDetailsFromOrder(ecommerceOrder),
        createdByUserId: req.user.id,
      });

      await createAuditLog({
        category: "dms_workflow",
        action: "shipment.registered_from_seller_qr",
        actor: actorForAudit(req),
        context: {
          courierCompanyId: deliveryOrder.courierCompanyId,
          branchId: deliveryOrder.assignedBranchId,
          deliveryOrderId: deliveryOrder._id,
          trackingNumber: deliveryOrder.trackingNumber,
          targetType: "delivery_order",
          targetId: `${deliveryOrder._id}`,
        },
        metadata: {
          ecommerceOrderId: `${ecommerceOrder._id}`,
          source: "seller_qr_scan",
        },
        req,
      });
    }

    if (["delivered", "returned"].includes(deliveryOrder.status)) {
      return res.status(409).json({
        message: "This shipment is already completed and cannot be scanned as seller handover.",
        trackingNumber: deliveryOrder.trackingNumber,
      });
    }

    const scanPayload = {
      scanType: "branch_received",
      scanMethod: "qr",
      branchId: context.branchId,
      notes: req.body.notes || "Seller handover received at delivery center.",
      geolocation: req.body.geolocation || {},
      occurredAt: req.body.occurredAt || new Date(),
      metadata: {
        ...(req.body.metadata || {}),
        source: "seller_qr_scan",
        ecommerceOrderId: `${ecommerceOrder._id}`,
        scannedQrText: req.body.qrText,
      },
    };

    const { order: updatedDeliveryOrder, event, fraudCheck } = await recordShipmentScan({
      req,
      order: deliveryOrder,
      scanPayload,
    });

    if (["pending", "confirmed"].includes(ecommerceOrder.status)) {
      ecommerceOrder.status = "shipped";
      await ecommerceOrder.save();
    }

    return res.json({
      message: "Seller QR scanned. Shipment moved from seller to delivery company.",
      ecommerceOrder: {
        id: ecommerceOrder._id,
        status: ecommerceOrder.status,
      },
      deliveryOrder: updatedDeliveryOrder,
      event,
      fraud: fraudCheck,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to scan seller QR", error: error.message });
  }
}

export async function getShipmentTracking(req, res) {
  try {
    const order = await DeliveryOrder.findOne({
      trackingNumber: req.params.trackingNumber,
    }).lean();
    if (!order) {
      return res.status(404).json({ message: "Shipment not found" });
    }

    const events = await ShipmentTrackingEvent.find({ deliveryOrderId: order._id })
      .sort({ occurredAt: 1 })
      .lean();

    return res.json({
      trackingNumber: order.trackingNumber,
      currentStatus: order.status,
      currentBranchId: order.currentBranchId,
      currentRiderId: order.currentRiderId,
      lastScan: order.scanSummary,
      movementHistory: events,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch tracking", error: error.message });
  }
}

export async function getRiderQueue(req, res) {
  try {
    const riderId = req.params.riderStaffId || req.dmsActor?.staffId;
    if (!riderId) return res.status(400).json({ message: "riderStaffId is required" });

    const rider = await CourierStaff.findById(riderId).lean();
    if (!rider || rider.role !== "delivery_rider") {
      return res.status(404).json({ message: "Rider not found" });
    }

    if (req.dmsActor.scope === "company" && `${rider.courierCompanyId}` !== req.dmsActor.courierCompanyId) {
      return res.status(403).json({ message: "Cannot access rider queue outside your company" });
    }

    if (req.dmsActor.scope === "branch" && `${rider.assignedBranchId || ""}` !== req.dmsActor.branchId) {
      return res.status(403).json({ message: "Cannot access rider queue outside your branch" });
    }

    if (req.dmsActor.scope === "rider" && req.dmsActor.staffId !== riderId) {
      return res.status(403).json({ message: "Riders can only access their own queue" });
    }

    const assignments = await DeliveryAssignment.find(
      withTenantScope(
        req,
        {
          riderStaffId: riderId,
          status: "active",
        },
        {
          branchFields: ["branchId"],
          riderField: "riderStaffId",
        }
      )
    )
      .sort({ queuePosition: 1, assignedAt: 1 })
      .populate("deliveryOrderId")
      .lean();

    return res.json({ count: assignments.length, assignments });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch rider queue", error: error.message });
  }
}

function applyShipmentViewFilter(filters, view) {
  if (view === "active") {
    filters.status = { $in: ["shipment_registered", "received_at_branch", "in_sorting", "out_for_delivery"] };
  }
  if (view === "delayed") {
    filters.expectedDeliveryAt = { $lt: new Date() };
    filters.status = { $nin: ["delivered", "returned"] };
  }
  if (view === "failed") {
    filters.status = "failed_delivery";
  }
  if (view === "returned") {
    filters.status = "returned";
  }
  if (view === "lost") {
    filters.status = "lost";
  }
}

export async function getCenterShipments(req, res) {
  try {
    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    applyShipmentViewFilter(filters, req.query.view || "active");

    const scoped = withTenantScope(req, filters, {
      branchFields: ["assignedBranchId", "currentBranchId"],
    });
    const shipments = await DeliveryOrder.find(scoped)
      .populate("sellerId", "fullName address email phone shopName")
      .populate("currentRiderId", "fullName employeeId phone")
      .sort({ createdAt: -1 })
      .lean();

    // Map sellerId to origin for frontend compatibility if needed
    const formattedShipments = shipments.map(s => ({
      ...s,
      origin: s.sellerId || s.origin
    }));

    return res.json({ count: formattedShipments.length, shipments: formattedShipments });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch center shipments", error: error.message });
  }
}

export async function getCenterRiderAssignments(req, res) {
  try {
    if (!req.dmsActor?.branchId) {
      return res.status(400).json({ message: "Center branch is not linked to this account" });
    }

    const filters = {
      status: "active",
      branchId: req.dmsActor.branchId,
    };

    if (req.dmsActor?.scope === "rider") {
      filters.riderStaffId = req.dmsActor.staffId;
    } else if (req.query.riderStaffId) {
      filters.riderStaffId = req.query.riderStaffId;
    }

    const assignments = await DeliveryAssignment.find(filters)
      .sort({ queuePosition: 1, assignedAt: 1 })
      .populate({
        path: "deliveryOrderId",
        populate: { path: "sellerId", select: "fullName address email phone shopName" }
      })
      .lean();

    const formattedAssignments = assignments.map(a => {
      if (a.deliveryOrderId) {
        a.deliveryOrderId.origin = a.deliveryOrderId.sellerId || a.deliveryOrderId.origin;
      }
      return a;
    });

    return res.json({ count: formattedAssignments.length, assignments: formattedAssignments });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch center rider assignments", error: error.message });
  }
}

export async function getAdminShipments(req, res) {
  try {
    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.courierCompanyId) filters.courierCompanyId = req.query.courierCompanyId;
    if (req.query.branchId) filters.assignedBranchId = req.query.branchId;

    applyShipmentViewFilter(filters, req.query.view);
    if (req.query.view === "disputed") {
      const disputedIds = await DeliveryDispute.find({ status: { $in: ["open", "investigating", "escalated"] } })
        .distinct("deliveryOrderId");
      filters._id = { $in: disputedIds };
    }

    const scoped = withTenantScope(req, filters);
    const shipments = await DeliveryOrder.find(scoped).sort({ createdAt: -1 }).lean();

    return res.json({
      count: shipments.length,
      shipments,
      metadata: {
        rulesConfigured: await DeliveryRule.countDocuments({ scope: "routing", isActive: true }),
        serviceZonesConfigured: await ServiceZone.countDocuments({ isActive: true }),
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch shipments", error: error.message });
  }
}


export async function initiateDeliveryConfirmation(req, res) {
  try {
    const { trackingNumber } = req.params;
    const order = await DeliveryOrder.findOne(withTenantScope(req, { trackingNumber }));

    if (!order) {
      return res.status(404).json({ message: "Shipment not found" });
    }

    if (order.status === "delivered") {
      return res.status(400).json({ message: "Shipment is already delivered" });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes expiry

    order.verification = {
      otp,
      otpExpiresAt: expiresAt,
      isVerified: false,
    };

    await order.save();

    // In a real system, send SMS here. For now, we log it and return it for demo.
    console.log(`[DMS] OTP for order ${trackingNumber}: ${otp}`);

    await createAuditLog({
      category: "dms_workflow",
      action: "shipment.delivery_otp_initiated",
      actor: actorForAudit(req),
      context: {
        courierCompanyId: order.courierCompanyId,
        branchId: order.currentBranchId,
        deliveryOrderId: order._id,
        trackingNumber: order.trackingNumber,
      },
      req,
    });

    return res.json({
      message: "Delivery OTP initiated. Please check your mobile device.",
      expiresAt,
      // Returning OTP for development/testing convenience
      otp: process.env.NODE_ENV === "production" ? undefined : otp,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to initiate delivery confirmation", error: error.message });
  }
}

export async function verifyDeliveryOtp(req, res) {
  try {
    const { trackingNumber } = req.params;
    const { otp } = req.body;

    if (!otp) {
      return res.status(400).json({ message: "OTP is required" });
    }

    const order = await DeliveryOrder.findOne(withTenantScope(req, { trackingNumber }));

    if (!order) {
      return res.status(404).json({ message: "Shipment not found" });
    }

    if (order.verification.otp !== otp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    if (order.verification.otpExpiresAt < new Date()) {
      return res.status(400).json({ message: "OTP has expired" });
    }

    order.verification.isVerified = true;
    order.verification.verifiedAt = new Date();
    order.status = "delivered";
    applyStatusTimeline(order, "delivered");

    if (order.cod && order.cod.enabled) {
      order.cod.collected = true;
      order.cod.collectedAt = new Date();
      order.cod.collectedByRiderId = req.dmsActor?.staffId || null;
    }

    await order.save();

    // Update Ecommerce Order
    if (order.ecommerceOrderId) {
      const ecommerceOrder = await Order.findById(order.ecommerceOrderId);
      if (ecommerceOrder) {
        ecommerceOrder.status = "delivered";
        await ecommerceOrder.save();
      }
    }

    await createAuditLog({
      category: "dms_workflow",
      action: "shipment.delivered_via_otp",
      actor: actorForAudit(req),
      context: {
        courierCompanyId: order.courierCompanyId,
        branchId: order.currentBranchId,
        deliveryOrderId: order._id,
        trackingNumber: order.trackingNumber,
      },
      req,
    });

    await emitDeliveryNotification({
      type: "delivered",
      recipients: [order.customerId, order.sellerId].filter(Boolean),
      payload: { trackingNumber: order.trackingNumber, status: "delivered" },
      actor: actorForAudit(req),
      context: { courierCompanyId: order.courierCompanyId, deliveryOrderId: order._id, trackingNumber: order.trackingNumber },
      req,
    });

    return res.json({
      message: "Shipment delivered successfully. OTP verified.",
      order,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to verify delivery OTP", error: error.message });
  }
}
