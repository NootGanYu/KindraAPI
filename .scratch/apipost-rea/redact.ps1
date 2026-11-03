param([string]$Dir = "D:\agent-workspace\963656544\KindraAPI\github\KindraAPI\.scratch\apipost-rea", [int]$CropBottom = 34)
Add-Type -AssemblyName System.Drawing
Get-ChildItem -Path $Dir -Filter *.png | ForEach-Object {
  $path = $_.FullName
  $img = [System.Drawing.Image]::FromFile($path)
  $w = $img.Width
  $h = [Math]::Max(1, $img.Height - $CropBottom)
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $srcRect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
  $g.DrawImage($img, 0, 0, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  $img.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  Write-Output "$($_.Name) -> ${w}x${h}"
}
