namespace MediaHub.WebServices;

internal class EmptyConstructorServerViewerFactory<T> : IViewerFactory
    where T : IServerViewer, new()
{
    public Task<IServerViewer> CreateAsync(
        string title,
        CancellationToken ct = default)
    {
        IServerViewer client = new T();

        return Task.FromResult(client);
    }
}