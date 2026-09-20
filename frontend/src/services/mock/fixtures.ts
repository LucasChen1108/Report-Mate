import { USER_ROLES } from "../../auth/contracts";
import type { TemplateSchema } from "../../api/types";
import type { TemplateRecord } from "../contracts";

export const MOCK_FIXTURES = {
  companies: {
    acme: { id: "company-acme", name: "Acme Facilities" },
    globex: { id: "company-globex", name: "Globex Services" },
  },
  users: {
    acmeAdmin: {
      id: "user-acme-admin",
      email: "admin@acme.example.test",
      password: "demo-admin-password",
    },
    acmeActiveWorker: {
      id: "user-acme-worker-active",
      email: "worker@acme.example.test",
      password: "demo-worker-password",
    },
    acmeInactiveWorker: {
      id: "user-acme-worker-inactive",
      email: "inactive@acme.example.test",
      password: "demo-inactive-password",
    },
    globexAdmin: {
      id: "user-globex-admin",
      email: "admin@globex.example.test",
      password: "demo-globex-password",
    },
    globexWorker: {
      id: "user-globex-worker",
      email: "worker@globex.example.test",
      password: "demo-globex-worker-password",
    },
  },
  codes: {
    acmeAdmin: "ADMIN-ACME-VALID",
    globexAdmin: "ADMIN-GLOBEX-VALID",
    validJoin: "JOIN-ACME-VALID",
    expiredJoin: "JOIN-ACME-EXPIRED",
    revokedJoin: "JOIN-ACME-REVOKED",
    usedJoin: "JOIN-ACME-USED",
    otherCompanyJoin: "JOIN-GLOBEX-VALID",
  },
  sessions: {
    expired: "mock-session-expired",
  },
} as const;

export interface MockCompanyRecord {
  id: string;
  name: string;
}

export interface MockUserRecord {
  id: string;
  fullName: string;
  companyId: string;
  phone: string;
  personalEmail: string;
  companyEmail: string;
  password: string;
  role: (typeof USER_ROLES)[keyof typeof USER_ROLES];
  isActive: boolean;
  managerId: string | null;
}

export type MockCodeKind = "company_admin" | "worker_join";
export type MockCodeStatus = "active" | "revoked" | "used";

export interface MockAuthorizationCodeRecord {
  id: string;
  rawCode: string;
  kind: MockCodeKind;
  companyId: string;
  createdByAdminId: string | null;
  createdAt: string;
  expiresAt: string;
  status: MockCodeStatus;
}

export interface MockSessionRecord {
  token: string;
  userId: string;
  expiresAt: string;
}

export interface MockSeedData {
  companies: MockCompanyRecord[];
  users: MockUserRecord[];
  codes: MockAuthorizationCodeRecord[];
  sessions: MockSessionRecord[];
  templates: TemplateRecord[];
}

const basicTemplateSchema: TemplateSchema = {
  version: 1,
  sections: [
    {
      id: "sec_visit",
      label: "Visit details",
      fields: [
        {
          id: "fld_notes",
          type: "text",
          label: "Work completed",
          required: true,
        },
        {
          id: "fld_photo",
          type: "photo",
          label: "Completion photo",
          required: false,
        },
      ],
    },
  ],
};

const safetyTemplateSchema: TemplateSchema = {
  version: 1,
  sections: [
    {
      id: "sec_safety",
      label: "Safety checks",
      fields: [
        {
          id: "fld_ppe",
          type: "checklist",
          label: "PPE verified",
          required: true,
          options: ["Gloves", "Eye protection", "Hard hat"],
        },
        {
          id: "fld_signoff",
          type: "signature",
          label: "Inspector sign-off",
          required: true,
        },
      ],
    },
  ],
};

export function createMockSeedData(): MockSeedData {
  const { companies, users, codes, sessions } = MOCK_FIXTURES;
  return {
    companies: [
      { ...companies.acme },
      { ...companies.globex },
    ],
    users: [
      {
        id: users.acmeAdmin.id,
        fullName: "Avery Admin",
        companyId: companies.acme.id,
        phone: "+65 8000 1001",
        personalEmail: "avery.admin@example.test",
        companyEmail: users.acmeAdmin.email,
        password: users.acmeAdmin.password,
        role: USER_ROLES.admin,
        isActive: true,
        managerId: null,
      },
      {
        id: users.acmeActiveWorker.id,
        fullName: "Taylor Technician",
        companyId: companies.acme.id,
        phone: "+65 8000 2001",
        personalEmail: "taylor@example.test",
        companyEmail: users.acmeActiveWorker.email,
        password: users.acmeActiveWorker.password,
        role: USER_ROLES.worker,
        isActive: true,
        managerId: users.acmeAdmin.id,
      },
      {
        id: users.acmeInactiveWorker.id,
        fullName: "Indigo Inactive",
        companyId: companies.acme.id,
        phone: "+65 8000 2002",
        personalEmail: "indigo@example.test",
        companyEmail: users.acmeInactiveWorker.email,
        password: users.acmeInactiveWorker.password,
        role: USER_ROLES.worker,
        isActive: false,
        managerId: users.acmeAdmin.id,
      },
      {
        id: users.globexAdmin.id,
        fullName: "Jordan Admin",
        companyId: companies.globex.id,
        phone: "+65 8000 3001",
        personalEmail: "jordan.admin@example.test",
        companyEmail: users.globexAdmin.email,
        password: users.globexAdmin.password,
        role: USER_ROLES.admin,
        isActive: true,
        managerId: null,
      },
      {
        id: users.globexWorker.id,
        fullName: "Morgan Technician",
        companyId: companies.globex.id,
        phone: "+65 8000 4001",
        personalEmail: "morgan@example.test",
        companyEmail: users.globexWorker.email,
        password: users.globexWorker.password,
        role: USER_ROLES.worker,
        isActive: true,
        managerId: users.globexAdmin.id,
      },
    ],
    codes: [
      {
        id: "code-admin-acme",
        rawCode: codes.acmeAdmin,
        kind: "company_admin",
        companyId: companies.acme.id,
        createdByAdminId: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        status: "active",
      },
      {
        id: "code-admin-globex",
        rawCode: codes.globexAdmin,
        kind: "company_admin",
        companyId: companies.globex.id,
        createdByAdminId: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        status: "active",
      },
      {
        id: "code-join-valid",
        rawCode: codes.validJoin,
        kind: "worker_join",
        companyId: companies.acme.id,
        createdByAdminId: users.acmeAdmin.id,
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        status: "active",
      },
      {
        id: "code-join-expired",
        rawCode: codes.expiredJoin,
        kind: "worker_join",
        companyId: companies.acme.id,
        createdByAdminId: users.acmeAdmin.id,
        createdAt: "2020-01-01T00:00:00.000Z",
        expiresAt: "2020-01-02T00:00:00.000Z",
        status: "active",
      },
      {
        id: "code-join-revoked",
        rawCode: codes.revokedJoin,
        kind: "worker_join",
        companyId: companies.acme.id,
        createdByAdminId: users.acmeAdmin.id,
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        status: "revoked",
      },
      {
        id: "code-join-used",
        rawCode: codes.usedJoin,
        kind: "worker_join",
        companyId: companies.acme.id,
        createdByAdminId: users.acmeAdmin.id,
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        status: "used",
      },
      {
        id: "code-join-globex",
        rawCode: codes.otherCompanyJoin,
        kind: "worker_join",
        companyId: companies.globex.id,
        createdByAdminId: users.globexAdmin.id,
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        status: "active",
      },
    ],
    sessions: [
      {
        token: sessions.expired,
        userId: users.acmeAdmin.id,
        expiresAt: "2020-01-01T00:00:00.000Z",
      },
    ],
    templates: [
      {
        id: "template-seed-service",
        name: "Service Visit",
        schema: basicTemplateSchema,
        isSeed: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "template-seed-safety",
        name: "Safety Inspection",
        schema: safetyTemplateSchema,
        isSeed: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}
