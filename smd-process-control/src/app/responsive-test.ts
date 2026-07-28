export function responsiveFixturesEnabled(isDevelopment: boolean, explicitFlag: boolean): boolean {
  return isDevelopment && explicitFlag;
}
