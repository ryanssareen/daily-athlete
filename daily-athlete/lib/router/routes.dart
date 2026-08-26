/// Named route constants. Use these instead of hard-coded path strings.
abstract final class Routes {
  static const loading = '/loading';
  static const signIn = '/sign-in';
  static const signUp = '/sign-up';
  static const dashboard = '/dashboard';
  static const athleteDetail = '/dashboard/athlete/:id';
  static const activities = '/activities';
  static const activityDetail = '/activities/:id';
  static const calendar = '/calendar';
  static const settings = '/settings';
  static const reports = '/reports';
  static const reportDetail = '/reports/:kind/:periodKey';
}
