using MediaHub.MediaAppData.SqlLite;
using Microsoft.EntityFrameworkCore;

namespace MediaHub.WebServices.MediaApp.DatabaseViews;

public class DatabaseTableView : AbstractDatabaseView
{
    public DatabaseTableView(IDbContextFactory<MediaHubDbContext> dbFactory)
        : base(dbFactory)
    {
    }

    public override string Route => DatabaseDebugRoutes.Table;

    protected override async Task<string> RenderAsync(HttpContext context)
    {
        string? tableName = context.Request.Query["name"];

        if (string.IsNullOrWhiteSpace(tableName))
        {
            return RenderErrorPage(
                "Missing table name",
                new ArgumentException("No table name was provided."));
        }

        return await RenderTablePageAsync(
            tableName,
            context.RequestAborted);
    }

    protected async Task<string> RenderTablePageAsync(
        string tableName,
        CancellationToken ct)
    {
        if (!await TableExistsAsync(tableName, ct))
        {
            return RenderErrorPage(
                tableName,
                new ArgumentException($"Table '{tableName}' does not exist."));
        }

        string sql = $"""
SELECT *
FROM "{EscapeIdentifier(tableName)}"
""";

        return await RenderQueryTableAsync(sql, ct);
    }

}