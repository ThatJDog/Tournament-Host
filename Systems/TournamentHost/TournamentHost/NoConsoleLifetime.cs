namespace TournamentHost.WebServices;

class NoConsoleLifetime : IHostLifetime, IDisposable
{
    public Task WaitForStartAsync(CancellationToken cancellationToken)
        => Task.CompletedTask;

    public Task StopAsync(CancellationToken cancellationToken)
        => Task.CompletedTask;

    public void Dispose() { }
}