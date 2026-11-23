$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$output = Join-Path (Split-Path -Parent $PSScriptRoot) "desktop\icon.ico"
$pngOutput = Join-Path (Split-Path -Parent $PSScriptRoot) "desktop\icon.png"
$sizes = @(16, 20, 24, 32, 48, 64, 128, 256)
$images = @()
foreach ($size in $sizes) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.ScaleTransform($size / 512.0, $size / 512.0)
  $shape = New-Object System.Drawing.Drawing2D.GraphicsPath
  $shape.AddArc(18, 18, 230, 230, 180, 90)
  $shape.AddArc(264, 18, 230, 230, 270, 90)
  $shape.AddArc(264, 264, 230, 230, 0, 90)
  $shape.AddArc(18, 264, 230, 230, 90, 90)
  $shape.CloseFigure()
  $background = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#f6f7ee"))
  $border = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml("#dce5d8"), 8)
  $mark = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml("#519a6c"), 28)
  $mark.StartCap = $mark.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.FillPath($background, $shape)
  $graphics.DrawPath($border, $shape)
  $graphics.DrawLine($mark, 256, 105, 256, 407)
  $graphics.DrawLine($mark, 105, 256, 407, 256)
  $graphics.DrawLine($mark, 149, 149, 363, 363)
  $graphics.DrawLine($mark, 149, 363, 363, 149)
  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $images += ,$stream.ToArray()
  $stream.Dispose(); $mark.Dispose(); $border.Dispose(); $background.Dispose()
  $shape.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}

$file = [System.IO.File]::Create($output)
$writer = New-Object System.IO.BinaryWriter($file)
try {
  $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
  $offset = 6 + 16 * $sizes.Count
  for ($i = 0; $i -lt $sizes.Count; $i++) {
    $dimension = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
    $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
    $writer.Write([byte]0); $writer.Write([byte]0)
    $writer.Write([uint16]1); $writer.Write([uint16]32)
    $writer.Write([uint32]$images[$i].Length); $writer.Write([uint32]$offset)
    $offset += $images[$i].Length
  }
  foreach ($image in $images) { $writer.Write([byte[]]$image) }
} finally {
  $writer.Dispose()
  $file.Dispose()
}
[System.IO.File]::WriteAllBytes($pngOutput, [byte[]]$images[$images.Count - 1])
Write-Output "Generated $output"
