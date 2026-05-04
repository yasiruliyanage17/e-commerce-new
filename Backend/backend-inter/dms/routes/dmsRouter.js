import express from "express";
import authMiddleware from "../../middleware/authMiddleware.js";
import { resolveDmsActor, requireDmsRoles } from "../middleware/dmsAccess.js";
import { registerCenterPortalAccount } from "../controllers/portalController.js";
import {
  registerCourierCompany,
  getAdminCouriers,
  approveCourierCompany,
  suspendCourierCompany,
} from "../controllers/courierController.js";
import {
  createBranch,
  listBranches,
  approveBranch,
  disableBranch,
} from "../controllers/branchController.js";
import {
  registerStaff,
  listStaff,
  approveStaff,
  suspendStaff,
  transferStaff,
  updateStaff,
} from "../controllers/staffController.js";
import {
  createShipment,
  assignShipment,
  scanShipment,
  scanSellerQrAtCenter,
  getShipmentTracking,
  getRiderQueue,
  getCenterShipments,
  getCenterRiderAssignments,
  getAdminShipments,
  initiateDeliveryConfirmation,
  verifyDeliveryOtp,
} from "../controllers/shipmentController.js";
import {
  createRoutingRule,
  listRoutingRules,
  createServiceZone,
  listServiceZones,
  createDispute,
  listDisputes,
  updateDispute,
  createSettlement,
  updateSettlementState,
  listSettlements,
  getAdminDashboard,
  getPortalProfile,
  getCourierDashboardSummary,
  getBranchDashboardSummary,
  getAdminCenterControlTower,
  verifyCenterByBranch,
  suspendCenterByBranch,
} from "../controllers/managementController.js";

const router = express.Router();

router.post("/portal/register", registerCenterPortalAccount);

router.use(authMiddleware, resolveDmsActor);

router.get("/portal/me", getPortalProfile);

router.post("/couriers/register", registerCourierCompany);

router.get("/admin/couriers", requireDmsRoles("dms_admin"), getAdminCouriers);
router.post("/admin/couriers/:courierId/approve", requireDmsRoles("dms_admin"), approveCourierCompany);
router.post("/admin/couriers/:courierId/suspend", requireDmsRoles("dms_admin"), suspendCourierCompany);

router.post("/branches/create", requireDmsRoles("dms_admin", "company_admin"), createBranch);
router.get("/branches", requireDmsRoles("dms_admin", "company_admin", "branch_manager", "dispatch_operator"), listBranches);
router.post("/admin/branches/:branchId/approve", requireDmsRoles("dms_admin"), approveBranch);
router.post("/admin/branches/:branchId/disable", requireDmsRoles("dms_admin", "company_admin"), disableBranch);

router.post("/staff/register", requireDmsRoles("dms_admin", "company_admin", "branch_manager"), registerStaff);
router.get("/staff", requireDmsRoles("dms_admin", "company_admin", "branch_manager", "dispatch_operator"), listStaff);
router.post("/admin/staff/:staffId/approve", requireDmsRoles("dms_admin", "company_admin"), approveStaff);
router.post("/admin/staff/:staffId/suspend", requireDmsRoles("dms_admin", "company_admin"), suspendStaff);
router.post("/admin/staff/:staffId/transfer", requireDmsRoles("dms_admin", "company_admin"), transferStaff);
router.patch(["/staff/profile", "/staff/profile/:staffId"], requireDmsRoles("dms_admin", "company_admin", "branch_manager", "delivery_rider"), updateStaff);

router.post("/shipments/create", requireDmsRoles("dms_admin", "company_admin", "branch_manager", "dispatch_operator", "seller"), createShipment);
router.post("/shipments/assign", requireDmsRoles("dms_admin", "company_admin", "branch_manager", "dispatch_operator"), assignShipment);
router.post("/shipments/scan", requireDmsRoles("dms_admin", "company_admin", "branch_manager", "dispatch_operator", "warehouse_staff", "delivery_rider"), scanShipment);
router.post("/shipments/scan-seller-qr", requireDmsRoles("dms_admin", "company_admin", "branch_manager", "dispatch_operator", "warehouse_staff", "delivery_rider"), scanSellerQrAtCenter);
router.post("/shipments/track/:trackingNumber/initiate-delivery", requireDmsRoles("dms_admin", "company_admin", "branch_manager", "dispatch_operator", "delivery_rider"), initiateDeliveryConfirmation);
router.post("/shipments/track/:trackingNumber/verify-otp", requireDmsRoles("dms_admin", "company_admin", "branch_manager", "dispatch_operator", "delivery_rider"), verifyDeliveryOtp);
router.get("/shipments/track/:trackingNumber", getShipmentTracking);
router.get("/shipments/rider/:riderStaffId/queue", requireDmsRoles("dms_admin", "company_admin", "branch_manager", "dispatch_operator", "delivery_rider"), getRiderQueue);
router.get("/shipments/my-queue", requireDmsRoles("delivery_rider"), getRiderQueue);

router.get("/admin/shipments", requireDmsRoles("dms_admin", "company_admin"), getAdminShipments);

router.post("/admin/routing-rules", requireDmsRoles("dms_admin", "company_admin"), createRoutingRule);
router.get("/admin/routing-rules", requireDmsRoles("dms_admin", "company_admin"), listRoutingRules);
router.post("/admin/service-zones", requireDmsRoles("dms_admin", "company_admin"), createServiceZone);
router.get("/admin/service-zones", requireDmsRoles("dms_admin", "company_admin"), listServiceZones);

router.post("/admin/disputes", requireDmsRoles("dms_admin", "company_admin", "seller"), createDispute);
router.get("/admin/disputes", requireDmsRoles("dms_admin", "company_admin"), listDisputes);
router.patch("/admin/disputes/:disputeId", requireDmsRoles("dms_admin", "company_admin"), updateDispute);

router.post("/admin/settlements", requireDmsRoles("dms_admin", "company_admin"), createSettlement);
router.patch("/admin/settlements/:settlementId", requireDmsRoles("dms_admin", "company_admin"), updateSettlementState);
router.get("/admin/settlements", requireDmsRoles("dms_admin", "company_admin"), listSettlements);
router.get("/admin/centers/control-tower", requireDmsRoles("dms_admin"), getAdminCenterControlTower);
router.post("/admin/centers/:branchId/verify", requireDmsRoles("dms_admin"), verifyCenterByBranch);
router.post("/admin/centers/:branchId/suspend", requireDmsRoles("dms_admin"), suspendCenterByBranch);

router.get(
  "/center/dashboard",
  requireDmsRoles("branch_manager", "dispatch_operator", "warehouse_staff", "delivery_rider"),
  getBranchDashboardSummary
);
router.get(
  "/center/shipments",
  requireDmsRoles("branch_manager", "dispatch_operator", "warehouse_staff", "delivery_rider"),
  getCenterShipments
);
router.get(
  "/center/rider-queue",
  requireDmsRoles("branch_manager", "dispatch_operator", "warehouse_staff", "delivery_rider"),
  getCenterRiderAssignments
);

router.get("/dashboards/super-admin", requireDmsRoles("dms_admin"), getAdminDashboard);
router.get("/dashboards/courier/:courierCompanyId", requireDmsRoles("dms_admin", "company_admin"), getCourierDashboardSummary);
router.get(
  "/dashboards/branch/:branchId",
  requireDmsRoles("dms_admin", "company_admin", "branch_manager", "dispatch_operator", "warehouse_staff", "delivery_rider"),
  getBranchDashboardSummary
);

export default router;

