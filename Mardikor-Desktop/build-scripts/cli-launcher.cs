using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

internal static class Launcher
{
    private const string PathStateKey = @"Software\Mardikor\Cli";
    private const string OwnedEntry = "PathEntry";

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessageTimeout(
        IntPtr window, uint message, UIntPtr wParam, string lParam,
        uint flags, uint timeout, out UIntPtr result);

    private static int Main(string[] args)
    {
        try
        {
            string bin = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            if (args.Length == 2 && (args[0] == "--register-path" || args[0] == "--unregister-path"))
            {
                if (args[1] != "all" && args[1] != "CurrentUser")
                    throw new ArgumentException("Invalid installation scope.");
                UpdatePath(bin, args[1] == "all", args[0] == "--register-path");
                return 0;
            }
            var start = new ProcessStartInfo
            {
                FileName = Path.Combine(Path.GetDirectoryName(bin), "Mardikor.exe"),
                Arguments = String.Join(" ", new[] { Path.Combine(bin, "mardikor.cjs") }
                    .Concat(args).Select(Quote)),
                UseShellExecute = false,
            };
            start.EnvironmentVariables["ELECTRON_RUN_AS_NODE"] = "1";
            using (Process child = Process.Start(start))
            {
                child.WaitForExit();
                return child.ExitCode;
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("mardikor: " + error.Message);
            return 1;
        }
    }

    // Quote for the Windows C runtime argv parser, with no shell in the middle.
    private static string Quote(string argument)
    {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in argument)
        {
            if (c == '\\') { slashes++; continue; }
            result.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
            result.Append(c);
            slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }

    private static bool EqualEntry(string left, string right)
    {
        return String.Equals(left, right, StringComparison.OrdinalIgnoreCase);
    }

    private static void UpdatePath(string bin, bool allUsers, bool install)
    {
        if (bin.IndexOf(';') >= 0)
            throw new ArgumentException("The installation directory contains a semicolon and cannot be added to PATH.");
        RegistryKey hive = allUsers ? Registry.LocalMachine : Registry.CurrentUser;
        string environmentKey = allUsers
            ? @"SYSTEM\CurrentControlSet\Control\Session Manager\Environment" : "Environment";
        using (RegistryKey environment = hive.CreateSubKey(environmentKey))
        using (RegistryKey state = hive.CreateSubKey(PathStateKey))
        {
            if (ChangePath(environment, state, bin, install))
            {
                UIntPtr ignored;
                SendMessageTimeout(new IntPtr(0xffff), 0x001a, UIntPtr.Zero, "Environment", 2, 1000, out ignored);
            }
        }
    }

    private static bool ChangePath(RegistryKey environment, RegistryKey state, string bin, bool install)
    {
        string previous = state.GetValue(OwnedEntry) as string;
        if (!install && !EqualEntry(previous, bin)) return false;
        string owned = previous;
        object value = environment.GetValue("Path", null, RegistryValueOptions.DoNotExpandEnvironmentNames);
        string current = value as string;
        if (value != null && current == null)
            throw new InvalidOperationException("The existing PATH registry value is not a string.");
        RegistryValueKind kind = current == null ? RegistryValueKind.ExpandString : environment.GetValueKind("Path");
        var entries = (String.IsNullOrEmpty(current) ? new string[0] : current.Split(';')).ToList();

        // Only remove the exact entry that this installer previously added.
        if (owned != null && (!install || !EqualEntry(owned, bin)))
        {
            int index = entries.FindLastIndex(entry => EqualEntry(entry, owned));
            if (index >= 0) entries.RemoveAt(index);
            owned = null;
        }
        if (install && !entries.Any(entry => EqualEntry(
            (kind == RegistryValueKind.ExpandString
                ? Environment.ExpandEnvironmentVariables(entry) : entry)
                .Trim().Trim('"').TrimEnd('\\', '/'), bin)))
        {
            entries.Add(bin);
            owned = bin;
        }
        string next = String.Join(";", entries);
        if (next.Length >= 32767)
            throw new InvalidOperationException("The resulting PATH exceeds the Windows environment limit.");
        SetOwnedEntry(state, owned);
        if (next == (current ?? "")) return false;
        try
        {
            if (next.Length == 0) environment.DeleteValue("Path", false);
            else environment.SetValue("Path", next, kind);
        }
        catch
        {
            SetOwnedEntry(state, previous);
            throw;
        }
        return true;
    }

    private static void SetOwnedEntry(RegistryKey state, string path)
    {
        if (path == null) state.DeleteValue(OwnedEntry, false);
        else state.SetValue(OwnedEntry, path);
    }
}
