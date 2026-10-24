# Types text and Enter into the console of a running program (Windows), as if typed on its keyboard.
# Hive uses it to send /bg to a Claude Code session, which moves it to the background without stopping it.
#   powershell -NoProfile -ExecutionPolicy Bypass -File type-into.ps1 -ProcessId <pid> -Text "/bg"
param([Parameter(Mandatory)][int]$ProcessId, [Parameter(Mandatory)][string]$Text)
Add-Type @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class ConsoleKeys {
  [StructLayout(LayoutKind.Explicit, CharSet = CharSet.Unicode)] public struct INPUT_RECORD {
    [FieldOffset(0)] public ushort EventType;
    [FieldOffset(4)] public int KeyDown; [FieldOffset(8)] public ushort RepeatCount; [FieldOffset(10)] public ushort VirtualKeyCode;
    [FieldOffset(12)] public ushort VirtualScanCode; [FieldOffset(14)] public char UnicodeChar; [FieldOffset(16)] public uint ControlKeyState;
  }
  [DllImport("kernel32.dll")] static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sa, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool WriteConsoleInputW(IntPtr h, INPUT_RECORD[] records, uint count, out uint written);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  static INPUT_RECORD Key(char c, ushort vk, bool down) { var r = new INPUT_RECORD(); r.EventType = 1; r.KeyDown = down ? 1 : 0; r.RepeatCount = 1; r.VirtualKeyCode = vk; r.UnicodeChar = c; return r; }
  public static string Type(uint pid, string text) {
    FreeConsole();                                     // a program can be on one console only: leave ours first
    if (!AttachConsole(pid)) return "error: could not reach its console (" + Marshal.GetLastWin32Error() + ")";
    IntPtr h = CreateFileW("CONIN$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if (h == new IntPtr(-1)) { FreeConsole(); return "error: no console input (" + Marshal.GetLastWin32Error() + ")"; }
    var keys = new List<INPUT_RECORD>();
    foreach (char c in text) { keys.Add(Key(c, 0, true)); keys.Add(Key(c, 0, false)); }
    uint n; bool ok = WriteConsoleInputW(h, keys.ToArray(), (uint)keys.Count, out n);
    // Enter on its own, a moment later: arriving in the same burst it would count as part of a paste (a new line).
    System.Threading.Thread.Sleep(400);
    var enter = new[] { Key('\r', 0x0D, true), Key('\r', 0x0D, false) };
    ok = ok && WriteConsoleInputW(h, enter, 2, out n);
    CloseHandle(h); FreeConsole();
    return ok ? "typed" : "error: could not type (" + Marshal.GetLastWin32Error() + ")";
  }
}
'@
[ConsoleKeys]::Type([uint32]$ProcessId, $Text)
