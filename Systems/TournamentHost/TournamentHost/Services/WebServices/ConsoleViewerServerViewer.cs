using MediaHub.ViewerService;

namespace MediaHub.WebServices;

internal class ConsoleViewerServerViewer : IServerViewer
{
    private ConsoleViewerClient _client;

    public bool IsClosed => _client.IsClosed;
    public bool AllowsInput => true;

    public ConsoleViewerServerViewer()
    {
        _client = new ConsoleViewerClient();
    }

    public async Task ClearAsync(CancellationToken ct = default)
    {
        await _client.ClearAsync();
    }

    public async ValueTask DisposeAsync()
    {
        await _client.DisposeAsync();
    }

    public async Task<string?> PromptAsync(CancellationToken ct = default)
    {
        return await _client.PromptAsync(ct: ct);
    }

    public async Task StartAsync(CancellationToken ct = default)
    {
        await _client.StartAsync(ConsoleViewerClient.DefaultEnvPath, ct);
    }

    public async Task WriteLineAsync(string text = "", CancellationToken ct = default)
    {
        await _client.WriteLineAsync(text);
    }
}
