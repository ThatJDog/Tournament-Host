namespace MediaHub.WebServices;

public sealed class ServerCommand
{
    public required string Name { get; init; }

    public string[] Aliases { get; init; } = [];

    public string? Description { get; init; }

    public required Func<CancellationToken, Task> ExecuteAsync { get; init; }

    public bool Matches(string input)
    {
        input = input.Trim().ToLowerInvariant();

        if (Name.Equals(input, StringComparison.OrdinalIgnoreCase))
            return true;

        return Aliases.Any(x =>
            x.Equals(input, StringComparison.OrdinalIgnoreCase));
    }
}