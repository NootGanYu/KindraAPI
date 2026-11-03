param([long]$Hwnd = 461634, [string]$OutDir = "D:\agent-workspace\963656544\KindraAPI\github\KindraAPI\.scratch\apipost-rea")

Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@

$h = [IntPtr]$Hwnd
[Win32]::ShowWindow($h, 9) | Out-Null
[Win32]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 1200

$rect = New-Object Win32+RECT
[Win32]::GetWindowRect($h, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$ht = $rect.Bottom - $rect.Top
Write-Output "RECT=$($rect.Left),$($rect.Top),$w,$ht"

Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
$png = Join-Path $OutDir "apipost-window.png"
$bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "SCREENSHOT=$png"

try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($h)
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $lines = New-Object System.Collections.Generic.List[string]
  function Walk($el, $depth) {
    if ($depth -gt 8) { return }
    $c = $el.Current
    $lines.Add(("  " * $depth) + "$($c.ControlType.ProgrammaticName) | name=$($c.Name) | id=$($c.AutomationId) | class=$($c.ClassName)")
    $child = $walker.GetFirstChild($el)
    while ($child -ne $null) {
      Walk $child ($depth + 1)
      $child = $walker.GetNextSibling($child)
    }
  }
  Walk $root 0
  $txt = Join-Path $OutDir "uia-tree.txt"
  $lines | Out-File -FilePath $txt -Encoding utf8
  Write-Output "UIA=$txt NODES=$($lines.Count)"
} catch {
  Write-Output "UIA_ERROR=$($_.Exception.Message)"
}
