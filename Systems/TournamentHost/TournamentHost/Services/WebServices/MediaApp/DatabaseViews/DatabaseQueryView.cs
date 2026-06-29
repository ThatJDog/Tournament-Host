using MediaHub.MediaAppData.SqlLite;
using Microsoft.EntityFrameworkCore;

namespace MediaHub.WebServices.MediaApp.DatabaseViews;

public sealed class DatabaseQueryView : AbstractDatabaseView
{
    private const string DefaultSql = """
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        ORDER BY name
        """;

    public DatabaseQueryView(IDbContextFactory<MediaHubDbContext> dbFactory)
        : base(dbFactory)
    {
    }

    public override string Route => DatabaseDebugRoutes.Query;

    protected override async Task<string> RenderAsync(HttpContext context)
    {
        string sql = context.Request.Query["sql"].ToString();

        if (string.IsNullOrWhiteSpace(sql))
            sql = DefaultSql;

        if (!IsReadOnlySql(sql))
        {
            return RenderErrorPage(
                sql,
                new InvalidOperationException("Only SELECT or WITH queries are allowed."),
                includeQueryForm: true);
        }

        return await RenderQueryTableAsync(
            sql,
            context.RequestAborted,
            includeQueryForm: true);
    }
}