/// Mirrors public.users row. See packages/shared/src/users.ts.
enum RoleFlag {
  athlete,
  coach;

  static RoleFlag fromString(String value) {
    return RoleFlag.values.firstWhere(
      (r) => r.name == value,
      orElse: () => RoleFlag.athlete,
    );
  }
}

class UserRow {
  const UserRow({
    required this.id,
    required this.email,
    required this.roleFlags,
    this.displayName,
    this.timezone,
    this.deletedAt,
  });

  final String id;
  final String email;
  final List<RoleFlag> roleFlags;
  final String? displayName;
  final String? timezone;
  final DateTime? deletedAt;

  /// Primary role — first element of role_flags. Defaults to athlete.
  RoleFlag get primaryRole => roleFlags.isNotEmpty ? roleFlags[0] : RoleFlag.athlete;

  factory UserRow.fromJson(Map<String, dynamic> json) {
    final flags = (json['role_flags'] as List<dynamic>? ?? ['athlete'])
        .map((f) => RoleFlag.fromString(f as String))
        .toList();
    return UserRow(
      id: json['id'] as String,
      email: json['email'] as String? ?? '',
      roleFlags: flags,
      displayName: json['display_name'] as String?,
      timezone: json['timezone'] as String?,
      deletedAt: json['deleted_at'] == null
          ? null
          : DateTime.parse(json['deleted_at'] as String),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'email': email,
        'role_flags': roleFlags.map((r) => r.name).toList(),
        if (displayName != null) 'display_name': displayName,
        if (timezone != null) 'timezone': timezone,
      };
}
