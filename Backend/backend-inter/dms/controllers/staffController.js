import bcrypt from "bcryptjs";
import userModel from "../../models/user.js";
import CourierStaff from "../models/courierStaff.js";
import CourierBranch from "../models/courierBranch.js";
import { STAFF_ROLES } from "../constants/dmsEnums.js";
import { withTenantScope } from "../middleware/dmsAccess.js";
import { createAuditLog } from "../services/auditService.js";
import { generateCode } from "../utils/idGenerator.js";
import { requireFields } from "../utils/validation.js";

function actorForAudit(req) {
  return {
    actorType: req.dmsActor?.actorType || "system",
    userId: req.dmsActor?.userId || null,
    staffId: req.dmsActor?.staffId || null,
    role: req.dmsActor?.actorRole || "",
  };
}

function normalizeEmail(value = "") {
  return `${value}`.toLowerCase().trim();
}

function parseName(fullName = "") {
  const parts = `${fullName}`.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "Rider",
    lastName: parts.slice(1).join(" ") || "",
  };
}

export async function registerStaff(req, res) {
  let createdAuthUser = null;
  let createdStaff = null;
  try {
    const missing = requireFields(req.body, ["courierCompanyId", "role", "fullName"]);
    if (missing.length) {
      return res.status(400).json({ message: `Missing fields: ${missing.join(", ")}` });
    }

    const courierCompanyId = `${req.body.courierCompanyId}`.trim();
    const role = `${req.body.role}`.trim();
    let assignedBranchId = req.body.assignedBranchId || null;
    const employeeId = `${req.body.employeeId || generateCode("EMP")}`.trim();

    if (!STAFF_ROLES.includes(role)) {
      return res.status(400).json({ message: `Invalid staff role: ${role}` });
    }

    if (req.dmsActor.scope === "company" && req.dmsActor.courierCompanyId !== courierCompanyId) {
      return res.status(403).json({ message: "Cannot register staff for another company" });
    }

    if (req.dmsActor.scope === "branch") {
      if (req.dmsActor.courierCompanyId !== courierCompanyId) {
        return res.status(403).json({ message: "Cannot register staff for another company" });
      }
      if (assignedBranchId && `${assignedBranchId}` !== req.dmsActor.branchId) {
        return res.status(403).json({ message: "Cannot register staff outside your branch" });
      }
      if (!req.dmsActor.branchId) {
        return res.status(400).json({ message: "Branch account is not linked to a center" });
      }
      assignedBranchId = req.dmsActor.branchId;
    }

    if (assignedBranchId) {
      const branch = await CourierBranch.findOne({
        _id: assignedBranchId,
        courierCompanyId,
      }).lean();
      if (!branch) {
        return res.status(400).json({ message: "Assigned branch does not belong to this company" });
      }
    }

    const exists = await CourierStaff.findOne({
      courierCompanyId,
      employeeId,
    }).lean();
    if (exists) {
      return res.status(409).json({ message: "Employee ID already exists in this company" });
    }

    const createLoginAccount = Boolean(req.body.password || req.body.createLoginAccount);
    const normalizedEmail = normalizeEmail(req.body.email || "");
    if (createLoginAccount) {
      if (!normalizedEmail || !normalizedEmail.includes("@")) {
        return res.status(400).json({ message: "Valid email is required to create rider login account" });
      }
      if (`${req.body.password || ""}`.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters long" });
      }
      if (req.body.authUserId) {
        return res.status(400).json({ message: "authUserId cannot be used when creating a new login account" });
      }
      const existingUser = await userModel.findOne({ email: normalizedEmail }).lean();
      if (existingUser) {
        return res.status(409).json({ message: "A user account already exists with this email" });
      }
      const hashedPassword = await bcrypt.hash(`${req.body.password}`, 10);
      const name = parseName(req.body.fullName);
      createdAuthUser = await userModel.create({
        email: normalizedEmail,
        firstName: name.firstName,
        lastName: name.lastName,
        password: hashedPassword,
        role: "customer",
        isEmailVerified: true,
        phone: req.body.phone || "",
      });
    }

    const staffStatus = role === "delivery_rider" && createLoginAccount ? "active" : "pending";
    createdStaff = await CourierStaff.create({
      courierCompanyId,
      assignedBranchId,
      authUserId: createdAuthUser?._id || req.body.authUserId || null,
      employeeId,
      role,
      fullName: req.body.fullName,
      phone: req.body.phone || "",
      email: normalizedEmail || req.body.email || "",
      idVerification: req.body.idVerification || {},
      status: staffStatus,
      createdByUserId: req.user.id,
    });

    await createAuditLog({
      category: "dms_ops",
      action: "staff.registered",
      actor: actorForAudit(req),
      context: {
        courierCompanyId: createdStaff.courierCompanyId,
        branchId: createdStaff.assignedBranchId,
        targetType: "courier_staff",
        targetId: `${createdStaff._id}`,
      },
      metadata: {
        employeeId: createdStaff.employeeId,
        role: createdStaff.role,
        hasAuthAccount: Boolean(createdStaff.authUserId),
      },
      req,
    });

    return res.status(201).json({
      message: createLoginAccount
        ? "Staff registration created with login account"
        : "Staff registration created",
      staff: createdStaff,
    });
  } catch (error) {
    await Promise.allSettled([
      createdStaff ? CourierStaff.deleteOne({ _id: createdStaff._id }) : Promise.resolve(),
      createdAuthUser ? userModel.deleteOne({ _id: createdAuthUser._id }) : Promise.resolve(),
    ]);
    return res.status(500).json({ message: "Failed to register staff", error: error.message });
  }
}

export async function listStaff(req, res) {
  try {
    const baseFilter = {};
    if (req.query.courierCompanyId) baseFilter.courierCompanyId = req.query.courierCompanyId;
    if (req.query.assignedBranchId) baseFilter.assignedBranchId = req.query.assignedBranchId;
    if (req.query.role) baseFilter.role = req.query.role;
    if (req.query.status) baseFilter.status = req.query.status;

    const staff = await CourierStaff.find(withTenantScope(req, baseFilter, {
      branchFields: ["assignedBranchId"],
      riderField: "_id",
    }))
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ count: staff.length, staff });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch staff", error: error.message });
  }
}

export async function approveStaff(req, res) {
  try {
    const staff = await CourierStaff.findById(req.params.staffId);
    if (!staff) return res.status(404).json({ message: "Staff not found" });
    if (req.dmsActor.scope === "company" && `${staff.courierCompanyId}` !== req.dmsActor.courierCompanyId) {
      return res.status(403).json({ message: "Cannot approve staff outside your company" });
    }

    staff.status = "active";
    if (req.body.idVerified !== undefined) {
      staff.idVerification.verified = Boolean(req.body.idVerified);
      staff.idVerification.verifiedAt = req.body.idVerified ? new Date() : null;
      staff.idVerification.verifiedByUserId = req.user.id;
    }
    await staff.save();

    await createAuditLog({
      category: "dms_ops",
      action: "staff.approved",
      actor: actorForAudit(req),
      context: {
        courierCompanyId: staff.courierCompanyId,
        branchId: staff.assignedBranchId,
        targetType: "courier_staff",
        targetId: `${staff._id}`,
      },
      req,
    });

    return res.json({ message: "Staff approved", staff });
  } catch (error) {
    return res.status(500).json({ message: "Failed to approve staff", error: error.message });
  }
}

export async function suspendStaff(req, res) {
  try {
    const staff = await CourierStaff.findById(req.params.staffId);
    if (!staff) return res.status(404).json({ message: "Staff not found" });
    if (req.dmsActor.scope === "company" && `${staff.courierCompanyId}` !== req.dmsActor.courierCompanyId) {
      return res.status(403).json({ message: "Cannot suspend staff outside your company" });
    }
    staff.status = "suspended";
    await staff.save();

    await createAuditLog({
      category: "dms_security",
      action: "staff.suspended",
      severity: "warn",
      actor: actorForAudit(req),
      context: {
        courierCompanyId: staff.courierCompanyId,
        branchId: staff.assignedBranchId,
        targetType: "courier_staff",
        targetId: `${staff._id}`,
      },
      metadata: { reason: req.body.reason || "" },
      req,
    });

    return res.json({ message: "Staff suspended", staff });
  } catch (error) {
    return res.status(500).json({ message: "Failed to suspend staff", error: error.message });
  }
}

export async function transferStaff(req, res) {
  try {
    const staff = await CourierStaff.findById(req.params.staffId);
    if (!staff) return res.status(404).json({ message: "Staff not found" });
    if (req.dmsActor.scope === "company" && `${staff.courierCompanyId}` !== req.dmsActor.courierCompanyId) {
      return res.status(403).json({ message: "Cannot transfer staff outside your company" });
    }
    if (!req.body.newBranchId) return res.status(400).json({ message: "newBranchId is required" });

    const branch = await CourierBranch.findOne({
      _id: req.body.newBranchId,
      courierCompanyId: staff.courierCompanyId,
      status: "approved",
    }).lean();
    if (!branch) {
      return res.status(400).json({ message: "Invalid target branch" });
    }

    const previousBranchId = staff.assignedBranchId;
    staff.assignedBranchId = req.body.newBranchId;
    await staff.save();

    await createAuditLog({
      category: "dms_ops",
      action: "staff.transferred",
      actor: actorForAudit(req),
      context: {
        courierCompanyId: staff.courierCompanyId,
        branchId: req.body.newBranchId,
        targetType: "courier_staff",
        targetId: `${staff._id}`,
      },
      metadata: { from: previousBranchId, to: req.body.newBranchId },
      req,
    });

    return res.json({ message: "Staff transferred", staff });
  } catch (error) {
    return res.status(500).json({ message: "Failed to transfer staff", error: error.message });
  }
}

export async function updateStaff(req, res) {
  try {
    const staffId = req.params.staffId || (req.dmsActor.scope === "rider" ? req.dmsActor.staffId : null);
    if (!staffId) return res.status(400).json({ message: "Staff ID is required" });

    const staff = await CourierStaff.findById(staffId);
    if (!staff) return res.status(404).json({ message: "Staff not found" });

    // Security check
    if (req.dmsActor.scope === "branch" && `${staff.assignedBranchId}` !== req.dmsActor.branchId) {
      return res.status(403).json({ message: "Cannot edit staff outside your branch" });
    }
    if (req.dmsActor.scope === "rider" && `${staff._id}` !== req.dmsActor.staffId) {
      return res.status(403).json({ message: "Cannot edit other riders" });
    }

    const { fullName, phone, email, idNumber } = req.body;
    
    if (email && email !== staff.email) {
      const existing = await userModel.findOne({ email });
      if (existing) return res.status(400).json({ message: "Email already in use" });
      
      staff.email = email;
      if (staff.authUserId) {
        await userModel.findByIdAndUpdate(staff.authUserId, { email });
      }
    }

    if (fullName) staff.fullName = fullName;
    if (phone) staff.phone = phone;
    if (idNumber) staff.idVerification.idNumber = idNumber;

    await staff.save();

    await createAuditLog({
      category: "dms_ops",
      action: "staff.updated",
      actor: actorForAudit(req),
      context: {
        courierCompanyId: staff.courierCompanyId,
        branchId: staff.assignedBranchId,
        targetType: "courier_staff",
        targetId: `${staff._id}`,
      },
      req,
    });

    return res.json({ message: "Staff updated successfully", staff });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update staff", error: error.message });
  }
}
