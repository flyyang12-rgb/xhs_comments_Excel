param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\xhs_chrome_extension\icons')
)

Add-Type -AssemblyName System.Drawing

function New-RoundedRectanglePath {
  param(
    [System.Drawing.RectangleF]$Rectangle,
    [float]$Radius
  )
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2
  $arc = [System.Drawing.RectangleF]::new($Rectangle.X, $Rectangle.Y, $diameter, $diameter)
  $path.AddArc($arc, 180, 90)
  $arc.X = $Rectangle.Right - $diameter
  $path.AddArc($arc, 270, 90)
  $arc.Y = $Rectangle.Bottom - $diameter
  $path.AddArc($arc, 0, 90)
  $arc.X = $Rectangle.X
  $path.AddArc($arc, 90, 90)
  $path.CloseFigure()
  return $path
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

foreach ($size in 16, 32, 48, 128) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $margin = [math]::Max(1, $size * 0.055)
  $radius = $size * 0.22
  $backgroundRect = [System.Drawing.RectangleF]::new($margin, $margin, $size - 2 * $margin, $size - 2 * $margin)
  $backgroundPath = New-RoundedRectanglePath -Rectangle $backgroundRect -Radius $radius
  $backgroundBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#FFF1F3'))
  $borderPen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#F6B8C1'), [math]::Max(1, $size * 0.035))
  $graphics.FillPath($backgroundBrush, $backgroundPath)
  $graphics.DrawPath($borderPen, $backgroundPath)

  $accent = [System.Drawing.ColorTranslator]::FromHtml('#EF3F54')
  $stroke = [math]::Max(1.35, $size * 0.095)
  $pen = [System.Drawing.Pen]::new($accent, $stroke)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $outer = $size * 0.27
  $arm = $size * 0.19
  $far = $size - $outer

  $graphics.DrawLine($pen, $outer, $outer + $arm, $outer, $outer)
  $graphics.DrawLine($pen, $outer, $outer, $outer + $arm, $outer)
  $graphics.DrawLine($pen, $far - $arm, $outer, $far, $outer)
  $graphics.DrawLine($pen, $far, $outer, $far, $outer + $arm)
  $graphics.DrawLine($pen, $outer, $far - $arm, $outer, $far)
  $graphics.DrawLine($pen, $outer, $far, $outer + $arm, $far)
  $graphics.DrawLine($pen, $far - $arm, $far, $far, $far)
  $graphics.DrawLine($pen, $far, $far - $arm, $far, $far)

  $dotSize = [math]::Max(2, $size * 0.16)
  $dotBrush = [System.Drawing.SolidBrush]::new($accent)
  $graphics.FillEllipse($dotBrush, ($size - $dotSize) / 2, ($size - $dotSize) / 2, $dotSize, $dotSize)

  $outputPath = Join-Path $OutputDirectory "icon-$size.png"
  $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)

  $dotBrush.Dispose()
  $pen.Dispose()
  $borderPen.Dispose()
  $backgroundBrush.Dispose()
  $backgroundPath.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

Write-Output "Generated extension icons in $OutputDirectory"
