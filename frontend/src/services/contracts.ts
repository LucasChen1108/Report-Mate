import type {
  AuthUser,
  CurrentProfile,
  GeneratedJoinCode,
  JoinCode,
  LoginInput,
  RegistrationInput,
  WorkerDetail,
  WorkerStatusUpdate,
  WorkerSummary,
} from "../auth/contracts";
import type { TemplateSchema } from "../api/types";

export interface ProfileUpdateInput {
  fullName: string;
  phone: string;
  personalEmail: string;
}

export interface GenerateJoinCodeInput {
  expiresAt?: string;
}

export interface TemplateSummary {
  id: string;
  name: string;
  isSeed: boolean;
  updatedAt: string;
}

export interface TemplateRecord extends TemplateSummary {
  schema: TemplateSchema;
  createdAt: string;
}

export interface TemplateWriteInput {
  name: string;
  schema: TemplateSchema;
}

export interface AuthService {
  login(input: LoginInput): Promise<AuthUser>;
  register(input: RegistrationInput): Promise<AuthUser>;
  getCurrentUser(): Promise<AuthUser | null>;
  logout(): Promise<void>;
}

export interface WorkerService {
  getCurrentProfile(): Promise<CurrentProfile>;
  updateCurrentProfile(input: ProfileUpdateInput): Promise<CurrentProfile>;
  listWorkers(): Promise<WorkerSummary[]>;
  updateWorkerStatus(
    workerId: string,
    input: WorkerStatusUpdate,
  ): Promise<WorkerDetail>;
  generateJoinCode(input?: GenerateJoinCodeInput): Promise<GeneratedJoinCode>;
  listJoinCodes(): Promise<JoinCode[]>;
  revokeJoinCode(joinCodeId: string): Promise<JoinCode>;
}

export interface TemplateService {
  list(): Promise<TemplateSummary[]>;
  get(id: string): Promise<TemplateRecord>;
  create(input: TemplateWriteInput): Promise<TemplateRecord>;
  update(id: string, input: TemplateWriteInput): Promise<TemplateRecord>;
}

export interface ServiceBundle {
  auth: AuthService;
  workers: WorkerService;
  templates: TemplateService;
}
