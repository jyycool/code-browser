using System.Runtime.InteropServices;

namespace CodeBrowser;

/// Platform + path helpers, mirroring the Node/Python SDKs' per-OS behavior.
internal static class Native
{
    public static bool IsWindows => RuntimeInformation.IsOSPlatform(OSPlatform.Windows);
    public static bool IsLinux => RuntimeInformation.IsOSPlatform(OSPlatform.Linux);
    public static bool IsMac => RuntimeInformation.IsOSPlatform(OSPlatform.OSX);

    /// Test seam: when set, overrides the reported OS (mirrors the Node/Python suites stubbing platform).
    internal static string? OsTagOverride;

    /// "windows" | "linux" | "macos" | "unknown" — matches the Node osTag()/Python plat mapping.
    public static string OsTag =>
        OsTagOverride ?? (IsWindows ? "windows" : IsLinux ? "linux" : IsMac ? "macos" : "unknown");

    /// Test seam: when set, overrides the reported CPU architecture (see <see cref="Arch"/>).
    internal static string? ArchOverride;

    /// The machine's CPU architecture, lower-cased ("arm64", "x64", ...). The OS architecture, not this
    /// process's: an x64 .NET under Rosetta on an Apple Silicon Mac still starts the arm64 browser natively.
    public static string Arch => ArchOverride ?? RuntimeInformation.OSArchitecture.ToString().ToLowerInvariant();

    /// Home dir. Reads HOME then USERPROFILE (so tests can redirect it, like the Node suite does).
    public static string HomeDir =>
        FirstNonEmpty(
            Environment.GetEnvironmentVariable("HOME"),
            Environment.GetEnvironmentVariable("USERPROFILE"))
        ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

    /// ~/.code-browser — where the license key, instance id, and lease cache live.
    public static string CodeBrowserDir => Path.Combine(HomeDir, ".code-browser");

    /// Per-OS binary cache root (CODE_BROWSER_CACHE overrides), matching download.ts defaultCacheRoot().
    public static string CacheRoot()
    {
        var env = Environment.GetEnvironmentVariable("CODE_BROWSER_CACHE");
        if (!string.IsNullOrEmpty(env)) return env;
        if (IsWindows)
        {
            var local = FirstNonEmpty(Environment.GetEnvironmentVariable("LOCALAPPDATA"))
                        ?? Path.Combine(HomeDir, "AppData", "Local");
            return Path.Combine(local, "code-browser", "Cache");
        }
        if (IsMac) return Path.Combine(HomeDir, "Library", "Caches", "code-browser");
        var xdg = FirstNonEmpty(Environment.GetEnvironmentVariable("XDG_CACHE_HOME"))
                  ?? Path.Combine(HomeDir, ".cache");
        return Path.Combine(xdg, "code-browser");
    }

    private static string? FirstNonEmpty(params string?[] values)
    {
        foreach (var v in values)
            if (!string.IsNullOrEmpty(v)) return v;
        return null;
    }
}

/// Test seam for HTTP: when <see cref="HandlerOverride"/> is set, every SDK HTTP call routes through
/// it — the .NET equivalent of the Node suite swapping global fetch. Left null in production.
internal static class SdkHttp
{
    internal static HttpMessageHandler? HandlerOverride;

    public static HttpClient Create()
    {
        var handler = HandlerOverride;
        return handler is null
            ? new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = true })
            : new HttpClient(handler, disposeHandler: false);
    }
}
