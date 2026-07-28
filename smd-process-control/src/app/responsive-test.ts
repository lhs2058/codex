export function responsiveFixturesEnabled(
  isDevelopment: boolean,
  explicitFlag: boolean,
  explicitRequest: boolean,
): boolean {
  return isDevelopment && explicitFlag && explicitRequest;
}
