import API_BASE_URL from "../config/api";

const DMS_API_BASE = `${API_BASE_URL}/api/dms`;
const AUTH_API_BASE = `${API_BASE_URL}/api/auth`;

function getDmsAuthToken() {
  return localStorage.getItem("dms_token");
}

function toQueryString(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && `${value}`.trim() !== "") {
      search.set(key, `${value}`);
    }
  });
  const q = search.toString();
  return q ? `?${q}` : "";
}

async function dmsRequest(path, { method = "GET", body, params } = {}) {
  const token = getDmsAuthToken();
  if (!token) {
    throw new Error("Authentication token not found");
  }

  const response = await fetch(`${DMS_API_BASE}${path}${toQueryString(params)}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.error ? `: ${data.error}` : "";
    throw new Error((data?.message || "DMS request failed") + detail);
  }

  return data;
}

async function plainRequest(url, { method = "GET", body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.error ? `: ${data.error}` : "";
    throw new Error((data?.message || "Request failed") + detail);
  }

  return data;
}

function persistDmsSession(data) {
  if (data?.token) {
    localStorage.setItem("dms_token", data.token);
  }
  if (data?.user) {
    localStorage.setItem("dms_user", JSON.stringify(data.user));
  }
}

export const dmsService = {
  registerCenterPortal(payload) {
    return plainRequest(`${DMS_API_BASE}/portal/register`, {
      method: "POST",
      body: payload,
    });
  },

  async loginWithPassword({ email, password }) {
    const data = await plainRequest(`${AUTH_API_BASE}/login/password`, {
      method: "POST",
      body: { email, password },
    });
    persistDmsSession(data);
    return data;
  },

  async getPortalProfile() {
    const data = await dmsRequest("/portal/me");
    localStorage.setItem("dmsPortalUser", JSON.stringify(data));
    return data;
  },

  clearPortalSession() {
    localStorage.removeItem("dmsPortalUser");
    localStorage.removeItem("dms_token");
    localStorage.removeItem("dms_user");
  },

  registerCourier(payload) {
    return dmsRequest("/couriers/register", { method: "POST", body: payload });
  },

  getCouriers(params = {}) {
    return dmsRequest("/admin/couriers", { params });
  },

  approveCourier(courierId, payload = {}) {
    return dmsRequest(`/admin/couriers/${courierId}/approve`, {
      method: "POST",
      body: payload,
    });
  },

  suspendCourier(courierId, payload = {}) {
    return dmsRequest(`/admin/couriers/${courierId}/suspend`, {
      method: "POST",
      body: payload,
    });
  },

  createBranch(payload) {
    return dmsRequest("/branches/create", { method: "POST", body: payload });
  },

  getBranches(params = {}) {
    return dmsRequest("/branches", { params });
  },

  registerStaff(payload) {
    return dmsRequest("/staff/register", { method: "POST", body: payload });
  },

  getStaff(params = {}) {
    return dmsRequest("/staff", { params });
  },

  getShipments(params = {}) {
    return dmsRequest("/admin/shipments", { params });
  },

  getCenterShipments(params = {}) {
    return dmsRequest("/center/shipments", { params });
  },

  getDisputes(params = {}) {
    return dmsRequest("/admin/disputes", { params });
  },

  getSettlements(params = {}) {
    return dmsRequest("/admin/settlements", { params });
  },

  getSuperAdminDashboard() {
    return dmsRequest("/dashboards/super-admin");
  },

  getCourierDashboard(courierCompanyId) {
    return dmsRequest(`/dashboards/courier/${courierCompanyId}`);
  },

  getBranchDashboard(branchId) {
    return dmsRequest(`/dashboards/branch/${branchId}`);
  },

  getCenterDashboard() {
    return dmsRequest("/center/dashboard");
  },

  getRiderQueue(riderStaffId) {
    if (riderStaffId) {
      return dmsRequest(`/shipments/rider/${riderStaffId}/queue`);
    }
    return dmsRequest("/shipments/my-queue");
  },

  getCenterRiderQueue(params = {}) {
    return dmsRequest("/center/rider-queue", { params });
  },

  scanSellerQr(payload) {
    return dmsRequest("/shipments/scan-seller-qr", {
      method: "POST",
      body: payload,
    });
  },
  initiateDeliveryConfirmation(trackingNumber) {
    return dmsRequest(`/shipments/track/${trackingNumber}/initiate-delivery`, {
      method: "POST",
    });
  },
  verifyDeliveryOtp(trackingNumber, otp) {
    return dmsRequest(`/shipments/track/${trackingNumber}/verify-otp`, {
      method: "POST",
      body: { otp },
    });
  },
  assignShipment(payload) {
    return dmsRequest("/shipments/assign", {
      method: "POST",
      body: payload,
    });
  },
  updateStaffProfile(payload, staffId = null) {
    const path = staffId ? `/staff/profile/${staffId}` : "/staff/profile";
    return dmsRequest(path, {
      method: "PATCH",
      body: payload,
    });
  },
};

