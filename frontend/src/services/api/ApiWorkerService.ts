import type {
  CurrentProfile,
  GeneratedJoinCode,
  JoinCode,
  WorkerDetail,
  WorkerStatusUpdate,
  WorkerSummary,
} from "../../auth/contracts";
import { API_ENDPOINTS, endpointBuilders } from "../../config/endpoints";
import type {
  GenerateJoinCodeInput,
  ProfileUpdateInput,
  WorkerService,
} from "../contracts";
import { apiRequest } from "./http";

export class ApiWorkerService implements WorkerService {
  constructor(private readonly baseUrl: string) {}

  getCurrentProfile(): Promise<CurrentProfile> {
    return apiRequest(this.baseUrl, "GET", API_ENDPOINTS.profile);
  }

  updateCurrentProfile(input: ProfileUpdateInput): Promise<CurrentProfile> {
    return apiRequest(this.baseUrl, "PATCH", API_ENDPOINTS.profile, input);
  }

  listWorkers(): Promise<WorkerSummary[]> {
    return apiRequest(this.baseUrl, "GET", API_ENDPOINTS.workers);
  }

  updateWorkerStatus(
    workerId: string,
    input: WorkerStatusUpdate,
  ): Promise<WorkerDetail> {
    return apiRequest(
      this.baseUrl,
      "PATCH",
      endpointBuilders.worker(workerId),
      input,
    );
  }

  generateJoinCode(
    input: GenerateJoinCodeInput = {},
  ): Promise<GeneratedJoinCode> {
    return apiRequest(this.baseUrl, "POST", API_ENDPOINTS.joinCodes, input);
  }

  listJoinCodes(): Promise<JoinCode[]> {
    return apiRequest(this.baseUrl, "GET", API_ENDPOINTS.joinCodes);
  }

  revokeJoinCode(joinCodeId: string): Promise<JoinCode> {
    return apiRequest(
      this.baseUrl,
      "DELETE",
      endpointBuilders.joinCode(joinCodeId),
    );
  }
}
