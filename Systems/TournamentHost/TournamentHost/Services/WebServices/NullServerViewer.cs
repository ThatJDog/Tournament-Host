using MediaHub.ViewerService;

namespace MediaHub.WebServices;

internal class NullServerViewer : IServerViewer
{
    private bool _isClosed;
    public bool IsClosed => _isClosed;
    public bool AllowsInput => false;

    public NullServerViewer() { }

    public async Task ClearAsync(CancellationToken ct = default) { }

    public async ValueTask DisposeAsync()
    {
        _isClosed = true;
    }

    public async Task<string?> PromptAsync(CancellationToken ct = default)
    {
        return null;
    }

    public async Task StartAsync(CancellationToken ct = default) { }

    public async Task WriteLineAsync(string text = "", CancellationToken ct = default) { }
}
