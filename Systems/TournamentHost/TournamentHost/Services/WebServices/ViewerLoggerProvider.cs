using System.Threading.Channels;

namespace MediaHub.WebServices;

internal sealed class ViewerLoggerProvider : ILoggerProvider
{
    private readonly IReadOnlyCollection<IServerViewer> _viewers;
    private readonly Channel<string> _lines = Channel.CreateUnbounded<string>();
    private readonly CancellationTokenSource _cts = new();
    private readonly Task _pumpTask;

    public ViewerLoggerProvider(IEnumerable<IServerViewer> viewers)
    {
        _viewers = viewers.ToArray();
        _pumpTask = Task.Run(PumpAsync);
    }

    public ILogger CreateLogger(string categoryName)
    {
        return new ServerViewerLogger(categoryName, _lines);
    }

    private async Task PumpAsync()
    {
        try
        {
            await foreach (var line in _lines.Reader.ReadAllAsync(_cts.Token))
            {
                foreach (var viewer in _viewers)
                {
                    if (viewer.IsClosed)
                        continue;

                    await viewer.WriteLineAsync(line);
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
    }

    public void Dispose()
    {
        _lines.Writer.TryComplete();
        _cts.Cancel();

        try
        {
            _pumpTask.Wait(TimeSpan.FromSeconds(1));
        }
        catch
        {
        }

        _cts.Dispose();
    }

    private sealed class ServerViewerLogger : ILogger
    {
        private readonly string _category;
        private readonly Channel<string> _lines;

        public ServerViewerLogger(string category, Channel<string> lines)
        {
            _category = category;
            _lines = lines;
        }

        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull
        {
            return null;
        }

        public bool IsEnabled(LogLevel logLevel)
        {
            return logLevel >= LogLevel.Information;
        }

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel))
                return;

            string message = formatter(state, exception);

            if (exception is not null)
                message += Environment.NewLine + exception;

            _lines.Writer.TryWrite(
                $"[{logLevel}] {_category}: {message}");
        }
    }
}