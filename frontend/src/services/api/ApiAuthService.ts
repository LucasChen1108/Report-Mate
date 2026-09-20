import type {
  AuthUser,
  LoginInput,
  RegistrationInput,
} from "../../auth/contracts";
import { API_ENDPOINTS } from "../../config/endpoints";
import type { AuthService } from "../contracts";
import { ServiceError } from "../errors";
import { apiRequest } from "./http";

export class ApiAuthService implements AuthService {
  constructor(private readonly baseUrl: string) {}

  login(input: LoginInput): Promise<AuthUser> {
    return apiRequest(this.baseUrl, "POST", API_ENDPOINTS.login, input);
  }

  register(input: RegistrationInput): Promise<AuthUser> {
    return apiRequest(this.baseUrl, "POST", API_ENDPOINTS.register, input);
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    try {
      return await apiRequest(
        this.baseUrl,
        "GET",
        API_ENDPOINTS.currentUser,
      );
    } catch (error) {
      if (error instanceof ServiceError && error.code === "unauthenticated") {
        return null;
      }
      throw error;
    }
  }

  logout(): Promise<void> {
    return apiRequest(this.baseUrl, "POST", API_ENDPOINTS.logout);
  }
}
