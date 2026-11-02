param(
  [long]$Hwnd,
  [string]$Mode = "shot",
  [int]$X = 0,
  [int]$Y = 0,
  [int]$Delta = -600,
  [string]$Out = ""
)

Add-Type @'
using System;
using System.Runtime.InteropServices;
public class W2 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@

$h = [IntPtr]$Hwnd
[W2]::ShowWindow($h, 9) | Out-Null
[W2]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 500
$rect = New-Object W2+RECT
[W2]::GetWindowRect($h, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$ht = $rect.Bottom - $rect.Top

if ($Mode -eq "click") {
  $ax = $rect.Left + $X
  $ay = $rect.Top + $Y
  [W2]::SetCursorPos($ax, $ay) | Out-Null
  Start-Sleep -Milliseconds 150
  [W2]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  [W2]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 600
}

if ($Mode -eq "scroll") {
  [W2]::SetCursorPos(($rect.Left + $X), ($rect.Top + $Y)) | Out-Null
  Start-Sleep -Milliseconds 150
  $steps = [Math]::Ceiling([Math]::Abs($Delta) / 120.0)
  $unit = if ($Delta -lt 0) { -120 } else { 120 }
  for ($i = 0; $i -lt $steps; $i++) {
    [W2]::mouse_event(0x0800, 0, 0, $unit, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 60
  }
  Start-Sleep -Milliseconds 500
}

if ($Mode -eq "shot" -or $Mode -eq "click" -or $Mode -eq "scroll") {
  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap $w, $ht
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
  $path = if ($Out -ne "") { $Out } else { "D:\agent-workspace\963656544\KindraAPI\github\KindraAPI\.scratch\apipost-rea\shot.png" }
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output "SHOT=$path RECT=$($rect.Left),$($rect.Top),$w,$ht"
}
