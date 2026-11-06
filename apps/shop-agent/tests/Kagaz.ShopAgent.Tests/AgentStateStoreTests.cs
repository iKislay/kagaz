using System.IO;
using System.Text.Json;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.Tests;

public class AgentStateStoreTests
{
    [Fact]
    public void Save_and_load_round_trip_preserves_state()
    {
        string root = Path.Combine(Path.GetTempPath(), "kagaz-state-tests", Guid.NewGuid().ToString("N"));
        string statePath = Path.Combine(root, "state.json");
        try
        {
            var store = new AgentStateStore(statePath);

            var original = new AgentState
            {
                PrintingPaused = true,
                RegisteredPrinterNames = new List<string> { "EPSON", "HP LaserJet" },
                Jobs =
                {
                    ["pj-1"] = new LocalJobState
                    {
                        Phase = "DOWNLOADED", OrderId = "o-1", PrintJobId = "pj-1", Attempt = 1,
                        PublicRef = "KGZ-AAAA", DocumentName = "KAGAZ-KGZ-AAAA-A1", PrinterName = "EPSON"
                    }
                }
            };
            store.Save(original);

            var loaded = store.Load();
            Assert.True(loaded.PrintingPaused);
            Assert.Equal(new List<string> { "EPSON", "HP LaserJet" }, loaded.RegisteredPrinterNames);
            Assert.True(loaded.Jobs.TryGetValue("pj-1", out var js));
            Assert.Equal("DOWNLOADED", js!.Phase);
            Assert.Equal("KGZ-AAAA", js.PublicRef);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    [Fact]
    public void Missing_file_returns_fresh_state()
    {
        string root = Path.Combine(Path.GetTempPath(), "kagaz-state-tests", Guid.NewGuid().ToString("N"));
        try
        {
            var store = new AgentStateStore(Path.Combine(root, "state.json"));
            var state = store.Load();
            Assert.False(state.PrintingPaused);
            Assert.Empty(state.Jobs);
            Assert.Empty(state.RegisteredPrinterNames);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    [Fact]
    public void Corrupt_file_returns_fresh_state_instead_of_crashing()
    {
        string root = Path.Combine(Path.GetTempPath(), "kagaz-state-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        string statePath = Path.Combine(root, "state.json");
        try
        {
            File.WriteAllText(statePath, "{ not valid json ");
            var store = new AgentStateStore(statePath);
            var state = store.Load();
            Assert.False(state.PrintingPaused);
            Assert.Empty(state.Jobs);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }
}
