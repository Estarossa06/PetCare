export interface AuthRouteGuards {
  loading: boolean;
  authentication: boolean;
  application: boolean;
}

export function getAuthRouteGuards(
  isLoading: boolean,
  isAuthenticated: boolean,
): AuthRouteGuards {
  return {
    loading: isLoading,
    authentication: !isLoading && !isAuthenticated,
    application: !isLoading && isAuthenticated,
  };
}
