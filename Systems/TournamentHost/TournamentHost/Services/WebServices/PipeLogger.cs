using System.IO.Pipes;

namespace MediaHub.WebServices;

class PipeLogger : ILogger
{
    private readonly string _category;

    private static NamedPipeServerStream? _pipe;
    private static StreamWriter? _writer;
    private static readonly object _lock = new();

    public PipeLogger(string category)
    {
        _category = category;

        lock (_lock)
        {
            if (_pipe == null)
            {
                _pipe = new NamedPipeServerStream(
                    "tournament_logs",
                    PipeDirection.Out,
                    1,
                    PipeTransmissionMode.Message,
                    PipeOptions.Asynchronous
                );

                // DON'T block constructor anymore
                _pipe.BeginWaitForConnection(ar =>
                {
                    try
                    {
                        _pipe.EndWaitForConnection(ar);
                        _writer = new StreamWriter(_pipe)
                        {
                            AutoFlush = true
                        };
                    }
                    catch { }
                }, null);
            }
        }
    }

    public IDisposable BeginScope<TState>(TState state) => null!;
    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(
        LogLevel logLevel,
        EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter)
    {
        var msg = formatter(state, exception);

        lock (_lock)
        {
            _writer?.WriteLine($"[{_category}] {msg}");
        }
    }
}

class PipeLoggerProvider : ILoggerProvider
{
    public ILogger CreateLogger(string categoryName)
        => new PipeLogger(categoryName);

    public void Dispose() { }
}