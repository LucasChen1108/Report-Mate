import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { ServiceBundle } from "./contracts";

const ServiceContext = createContext<ServiceBundle | null>(null);

interface ServiceProviderProps {
  services: ServiceBundle;
  children: ReactNode;
}

export function ServiceProvider({ services, children }: ServiceProviderProps) {
  return (
    <ServiceContext.Provider value={services}>
      {children}
    </ServiceContext.Provider>
  );
}

export function useServices(): ServiceBundle {
  const services = useContext(ServiceContext);
  if (!services) {
    throw new Error("useServices must be used within a ServiceProvider");
  }
  return services;
}
