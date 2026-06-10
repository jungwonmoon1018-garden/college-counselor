using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace CollegeCounselor;

/// DPAPI-protected at-rest storage for the session token + email (PII). The
/// Windows parallel to the Apple app's Keychain usage. Scoped to the current
/// user (CurrentUser), so the blobs are unreadable by other accounts.
internal static class TokenStore
{
    private static readonly string Dir =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "CollegeCounselor");

    private static string PathFor(string account) => Path.Combine(Dir, account + ".bin");

    public static void Set(string account, string value)
    {
        try
        {
            Directory.CreateDirectory(Dir);
            var enc = ProtectedData.Protect(Encoding.UTF8.GetBytes(value), null, DataProtectionScope.CurrentUser);
            File.WriteAllBytes(PathFor(account), enc);
        }
        catch { /* best-effort */ }
    }

    public static string? Get(string account)
    {
        try
        {
            var p = PathFor(account);
            if (!File.Exists(p)) return null;
            var dec = ProtectedData.Unprotect(File.ReadAllBytes(p), null, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(dec);
        }
        catch { return null; }
    }

    public static void Delete(string account)
    {
        try { var p = PathFor(account); if (File.Exists(p)) File.Delete(p); }
        catch { /* best-effort */ }
    }
}
