using System.Text;
using Kagaz.ShopAgent.App.Services;

namespace Kagaz.ShopAgent.Tests;

/// <summary>The Jobs preview renders pages with Windows' PDF renderer.</summary>
public class PdfPreviewTests
{
    [Fact]
    public async Task Renders_each_page_at_the_requested_width()
    {
        var preview = await PdfPreview.FromBytesAsync(TwoPagePdf());

        Assert.Equal(2, preview.PageCount);
        var page = await preview.RenderAsync(1, width: 600);
        Assert.True(page.PixelWidth >= 600); // Windows scales the width by the display scale (e.g. 750 at 125 %)
        Assert.InRange(page.PixelHeight / (double)page.PixelWidth, 1.40, 1.43); // A4 portrait: 297/210 ≈ 1.414
    }

    /// <summary>Smallest valid two-page A4 PDF, with a correct xref table.</summary>
    private static byte[] TwoPagePdf()
    {
        string[] objects =
        [
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>",
        ];
        var pdf = new StringBuilder("%PDF-1.4\n");
        var offsets = new List<int>();
        for (int i = 0; i < objects.Length; i++)
        {
            offsets.Add(pdf.Length);
            pdf.Append($"{i + 1} 0 obj\n{objects[i]}\nendobj\n");
        }
        int xref = pdf.Length;
        pdf.Append($"xref\n0 {objects.Length + 1}\n0000000000 65535 f \n");
        foreach (int offset in offsets) pdf.Append($"{offset:D10} 00000 n \n");
        pdf.Append($"trailer\n<< /Size {objects.Length + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n");
        return Encoding.ASCII.GetBytes(pdf.ToString());
    }
}
