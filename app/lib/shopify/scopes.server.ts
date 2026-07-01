export function getConfiguredScopes(value = process.env.SCOPES) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
  );
}

export function hasConfiguredScope(scope: string, value = process.env.SCOPES) {
  return getConfiguredScopes(value).has(scope);
}
